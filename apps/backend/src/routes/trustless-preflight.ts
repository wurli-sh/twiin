import { Hono } from "hono";
import { formatEther } from "viem";
import { z } from "zod";
import { NativeConfigId, encodeCreateTrustlessTask } from "@twiin/shared";
import { addresses, agentRegistryContract, deployment } from "../contracts";
import { publicClient } from "../clients";
import { env, type Env } from "../env";
import { computeJaniceCostWei, minimumTrustlessBudgetWei } from "../trustless";

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
  readRequestDeposit: () => Promise<bigint>;
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
    readRequestDeposit: () =>
      publicClient.readContract({
        address: deployment.agentsApi as `0x${string}`,
        abi: AgentsApiAbi,
        functionName: "getRequestDeposit",
      }),
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
    const minBudgetWei = minimumTrustlessBudgetWei(janiceCostWei);
    if (budget < minBudgetWei) {
      return c.json(
        {
          error: "trustless budget below minimum",
          budgetWei,
          minBudgetWei: minBudgetWei.toString(),
          janiceCostWei: janiceCostWei.toString(),
        },
        422,
      );
    }

    return c.json({
      orchestrator: deps.orchestrator,
      createTaskCalldata: encodeCreateTrustlessTask({
        personalAgentId: BigInt(personalAgentId),
        goal,
        budgetWei: budget,
      }),
      budgetWei,
      minBudgetWei: minBudgetWei.toString(),
      janiceCostWei: janiceCostWei.toString(),
      maxIterations: 8,
      warnings: [
        `Trustless mode can spend up to ${formatEther(budget)} STT from the task escrow.`,
        `Each Janice round currently costs about ${formatEther(janiceCostWei)} STT.`,
      ],
    });
  });

  return router;
}
