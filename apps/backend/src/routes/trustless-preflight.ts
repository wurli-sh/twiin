import { Hono } from "hono";
import { formatEther } from "viem";
import { z } from "zod";
import { MAX_JANICE_ITERATIONS, NativeConfigId, encodeCreateTrustlessTask } from "@twiin/shared";
import {
  addresses,
  agentRegistryContract,
  capabilityNameById,
  deployment,
} from "../contracts";
import { publicClient } from "../clients";
import { listExternalAgents } from "../db";
import { env, type Env } from "../env";
import {
  buildTrustlessAgentContext,
  computeJaniceCostWei,
  estimateTrustlessBudget,
  exactNativeStepCostWei,
} from "../trustless";

const TrustlessPreflightSchema = z.object({
  goal: z.string().min(1).max(2000),
  personalAgentId: z.string().regex(/^[0-9]+$/),
  budgetWei: z.string().regex(/^[0-9]+$/),
});

const AgentsApiAbi = [
  {
    type: "function",
    name: "getRequestDeposit",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export type TrustlessPreflightDeps = {
  env: Env;
  orchestrator: `0x${string}`;
  readJaniceAgent: () => Promise<{ isActive: boolean; suspended: boolean; costWei: bigint }>;
  readAgent: (configId: bigint) => Promise<{
    name: string;
    costWei: bigint;
    isActive: boolean;
    suspended: boolean;
  }>;
  readRequestDeposit: () => Promise<bigint>;
  listExternalAgents: typeof listExternalAgents;
  capabilityNameById: Map<string, string>;
};

export function createTrustlessPreflightRouter(
  overrides: Partial<TrustlessPreflightDeps> = {},
): Hono {
  const deps: TrustlessPreflightDeps = {
    env,
    orchestrator: addresses.orchestrator,
    readJaniceAgent: async () => {
      const raw = await agentRegistryContract.read.get([BigInt(NativeConfigId.JANICE)]);
      return {
        isActive: Boolean(raw.isActive),
        suspended: Boolean(raw.suspended),
        costWei: raw.costWei,
      };
    },
    readAgent: (configId) => agentRegistryContract.read.get([configId]),
    readRequestDeposit: () =>
      publicClient.readContract({
        address: deployment.agentsApi as `0x${string}`,
        abi: AgentsApiAbi,
        functionName: "getRequestDeposit",
      }),
    listExternalAgents,
    capabilityNameById,
    ...overrides,
  };

  const router = new Hono();

  router.post("/", async (c) => {
    if (!deps.env.ENABLE_TRUSTLESS_JANICE) {
      return c.json({ error: "trustless mode disabled" }, 404);
    }

    const parsed = TrustlessPreflightSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "invalid request body" }, 400);
    }

    const { goal, personalAgentId, budgetWei } = parsed.data;
    const budget = BigInt(budgetWei);
    const janiceAgent = await deps.readJaniceAgent();
    if (!janiceAgent.isActive || janiceAgent.suspended) {
      return c.json({ error: "janice unavailable" }, 503);
    }

    const requestDepositWei = await deps.readRequestDeposit();
    const janiceCostWei = computeJaniceCostWei(requestDepositWei, janiceAgent.costWei);
    const nativeAgentCostsByConfigId = new Map<number, bigint>();
    for (const configId of [NativeConfigId.ORACLE, NativeConfigId.ANALYSIS, NativeConfigId.REPORTER]) {
      try {
        const agent = await deps.readAgent(BigInt(configId));
        if (!agent.isActive || agent.suspended) continue;
        nativeAgentCostsByConfigId.set(
          configId,
          exactNativeStepCostWei(requestDepositWei, agent.costWei),
        );
      } catch {
        // Helpful for budgeting, but do not fail preflight if a native config read is unavailable.
      }
    }
    const budgetEstimate = estimateTrustlessBudget({
      goal,
      janiceCostWei,
      nativeAgentCostsByConfigId,
    });
    const minBudgetWei = budgetEstimate.minBudgetWei;
    if (budget < minBudgetWei) {
      return c.json(
        {
          error: "trustless budget below minimum",
          budgetWei,
          minBudgetWei: minBudgetWei.toString(),
          recommendedBudgetWei: budgetEstimate.recommendedBudgetWei.toString(),
          janiceCostWei: janiceCostWei.toString(),
          reason: budgetEstimate.reason,
        },
        422,
      );
    }

    let contextMessage = "";
    try {
      const externalAgents = (await deps.listExternalAgents({
        activeOnly: true,
        verifiedOnly: true,
      }))
        .sort((a, b) => Number(a.config_id) - Number(b.config_id))
        .slice(0, 20);
      contextMessage = await buildTrustlessAgentContext(
        externalAgents,
        deps.capabilityNameById,
        deps.readAgent,
      );
    } catch {
      // Registry context is helpful but non-fatal.
    }

    return c.json({
      orchestrator: deps.orchestrator,
      createTaskCalldata: encodeCreateTrustlessTask({
        personalAgentId: BigInt(personalAgentId),
        goal,
        contextMessage,
        budgetWei: budget,
      }),
      budgetWei,
      minBudgetWei: minBudgetWei.toString(),
      recommendedBudgetWei: budgetEstimate.recommendedBudgetWei.toString(),
      janiceCostWei: janiceCostWei.toString(),
      maxIterations: MAX_JANICE_ITERATIONS,
      warnings: [
        `Trustless mode can spend up to ${formatEther(budget)} STT from the task escrow.`,
        `Each Janice round currently costs about ${formatEther(janiceCostWei)} STT.`,
        budgetEstimate.reason,
      ],
    });
  });

  return router;
}
