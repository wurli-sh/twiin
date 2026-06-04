import { Hono } from "hono";
import type { Context } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import { encodeFunctionData, formatEther, parseEther } from "viem";
import {
  AgentLane,
  AgentOrchestratorAbi,
  encodeStepPayload,
  NativeConfigId,
  PlanMode,
} from "@twiin/shared";
import { z } from "zod";
import type { IncomingMessage } from "http";
import { env, type Env } from "../env";
import { createAnthropicBudgetGuard } from "../budget";
import {
  addresses,
  agentRegistryContract,
  capabilityNameById,
  deployment,
} from "../contracts";
import { publicClient } from "../clients";
import { listExternalAgents, savePlanRequest } from "../db";
import { parsePlannerStepsJson } from "../planner-json";

// Fixed-window rate limiter — 10 req/min per IP, with expired-entry eviction
const rateWindows = new Map<string, { count: number; resetAt: number }>();

function getClientIp(c: Context, config: Pick<Env, "TRUST_PROXY">): string {
  if (config.TRUST_PROXY) {
    const xff = c.req.header("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
  }
  // Use real socket address — cannot be spoofed by client headers
  const incoming = (c.env as { incoming?: IncomingMessage } | undefined)
    ?.incoming;
  return incoming?.socket?.remoteAddress ?? "unknown";
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  // Evict all expired entries on every check to prevent unbounded growth
  for (const [key, entry] of rateWindows) {
    if (entry.resetAt < now) rateWindows.delete(key);
  }
  const entry = rateWindows.get(ip);
  if (!entry) {
    rateWindows.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}

const PlanBodySchema = z.object({
  goal: z.string().min(1).max(2000),
  personalAgentId: z.string().regex(/^[0-9]+$/),
  budgetWei: z.string().regex(/^[0-9]+$/),
});

const StepSpecSchema = z.object({
  configId: z.number().int().min(0).max(100),
  payload: z.string().min(1).max(4000),
  maxCostWei: z.union([z.string().min(1), z.number(), z.null()]).optional(),
  timeoutSeconds: z.number().int().min(60).max(600),
});
const StepsOutputSchema = z.array(StepSpecSchema).min(1).max(6);

type StepSpec = z.infer<typeof StepSpecSchema>;

type AgentRecord = {
  lane: number;
  isActive: boolean;
  suspended: boolean;
  name: string;
  costWei: bigint;
};

type ExternalAgentRecord = Awaited<
  ReturnType<typeof listExternalAgents>
>[number];

export type PlanRouterDeps = {
  anthropic: Pick<Anthropic, "messages">;
  env: Env;
  addresses: { orchestrator: `0x${string}` };
  readNextConfigId: () => Promise<bigint>;
  readAgent: (configId: bigint) => Promise<AgentRecord>;
  readRequestDeposit: () => Promise<bigint>;
  savePlanRequest: (
    personalAgentId: string,
    goal: string,
    stepsJson: string,
    budgetWei: string,
  ) => Promise<void>;
  listExternalAgents: typeof listExternalAgents;
  capabilityNameById: Map<string, string>;
  plannerBudgetGuard: {
    ensureRequestAllowed: () => void;
    recordUsage: (usage: unknown, model: string) => void;
    noteFailure: (error: unknown) => void;
  };
};

const NATIVE_AGENT_LABELS: Record<number, string> = {
  [NativeConfigId.WEB_INTEL]: "web-intel@twiin",
  [NativeConfigId.ORACLE]: "somnia-oracle@twiin",
  [NativeConfigId.ANALYSIS]: "analysis-bot@twiin",
  [NativeConfigId.REPORTER]: "reporter-bot@twiin",
};

// deposit (~0.03) + per-agent runner × 3 — matches Somnia list prices in deploy.ts
const FALLBACK_COST_LINES = [
  `- configId ${NativeConfigId.WEB_INTEL} (web-intel@twiin): exact authorization ~0.33 STT`,
  `- configId ${NativeConfigId.ORACLE} (somnia-oracle@twiin): exact authorization ~0.12 STT`,
  `- configId ${NativeConfigId.ANALYSIS} (analysis-bot@twiin): exact authorization ~0.24 STT`,
  `- configId ${NativeConfigId.REPORTER} (reporter-bot@twiin): exact authorization ~0.24 STT`,
].join("\n");

const FALLBACK_CHEAPEST_COST_WEI = parseEther("0.12");

const AGENT_CONTEXT_HEADER = `
Rules:
- Max 6 steps total.
- Steps run sequentially; each step can reference "previous results" in its payload.
- timeoutSeconds must be between 60 and 600.
- maxCostWei will be normalized server-side to the exact contract-required authorization. Still return a reasonable decimal wei string.
- Do NOT use configId 0 (janice) or configId 5 (executor) — they are reserved.
- Return ONLY a valid JSON array with no markdown or explanation.
`.trim();

async function buildPlannerCostContext(deps: PlanRouterDeps): Promise<{
  costLines: string;
  cheapestCostWei: bigint;
}> {
  const nextConfigId = await deps.readNextConfigId();
  const requestDeposit = await deps.readRequestDeposit();
  const lines: string[] = [];
  let cheapest = 0n;

  for (let id = NativeConfigId.WEB_INTEL; id <= NativeConfigId.REPORTER; id++) {
    try {
      const agent = await deps.readAgent(BigInt(id));
      if (!agent.isActive || agent.suspended || !agent.name) continue;
      const exactCostWei =
        agent.lane === 0 ? requestDeposit + agent.costWei * 3n : agent.costWei;
      if (cheapest === 0n || exactCostWei < cheapest) cheapest = exactCostWei;
      lines.push(
        `- configId ${id} (${NATIVE_AGENT_LABELS[id] ?? agent.name}): exact authorization ${formatEther(exactCostWei)} STT`,
      );
    } catch {
      /* skip unavailable agents */
    }
  }

  try {
    const externalAgents = (await deps.listExternalAgents({
      activeOnly: true,
      verifiedOnly: true,
    }))
      .sort((a, b) => Number(a.config_id) - Number(b.config_id))
      .slice(0, 20);

    for (const ext of externalAgents) {
      const configId = BigInt(ext.config_id);
      if (configId >= nextConfigId) continue;
      const agent = await deps.readAgent(configId);
      if (!agent.isActive || agent.suspended) continue;
      const exactCostWei =
        agent.lane === 0 ? requestDeposit + agent.costWei * 3n : agent.costWei;
      if (cheapest === 0n || exactCostWei < cheapest) cheapest = exactCostWei;
      lines.push(
        `- configId ${ext.config_id} (${agent.name}): external agent, exact authorization ${formatEther(exactCostWei)} STT`,
      );
    }
  } catch {
    /* non-fatal */
  }

  return {
    costLines: lines.join("\n"),
    cheapestCostWei: cheapest,
  };
}

function buildSystemPrompt(
  agentContext: string,
  costLines: string,
  budgetEth: string,
  cheapestCostEth: string,
  maxAffordableSteps: number,
): string {
  return `You are a planner for the Twiin AI agent system on the Somnia blockchain.
Given a user goal, decompose it into sequential steps using the available sub-agents.
The user's budget is ${budgetEth} STT total — the sum of all step authorization costs MUST NOT exceed this.

EXACT per-step authorization costs (on-chain, not estimates):
${costLines}

Cheapest step costs about ${cheapestCostEth} STT. At this budget you can afford at most ${maxAffordableSteps} step(s).
Prefer the minimum number of steps. If the goal cannot fit, use one cheap step that best addresses the core ask.

${agentContext}

Return a JSON array of step objects with this exact shape:
[{"configId": number, "payload": "string", "maxCostWei": "decimal string", "timeoutSeconds": number}]`;
}

const AGENT_CONTEXT = `
Available sub-agents (use their configId):
- configId ${NativeConfigId.WEB_INTEL} (web-intel@twiin): Scrapes a web page and extracts data via LLM. payload=JSON {"url":"https://...","prompt":"what to extract"}.
  For a numeric field add "output":"number" (optional "min"/"max" as 0 to disable bounds). Only use when you know the exact HTTPS URL.
- configId ${NativeConfigId.ORACLE} (somnia-oracle@twiin): Fetches a JSON API with a DIRECT endpoint (not search/discovery).
  payload=JSON {"url":"https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd","selector":"bitcoin.usd","decimals":8} for prices.
  NEVER use /search? URLs or selectors like coins.0.id — they fail when the API returns empty results.
- configId ${NativeConfigId.ANALYSIS} (analysis-bot@twiin): Analyzes text/data, produces insights. payload=plain text instruction
- configId ${NativeConfigId.REPORTER} (reporter-bot@twiin): Writes a final report from data. payload=plain text instruction

For research / "should I LP" / unknown-token goals without a known CoinGecko id: use analysis-bot then reporter-bot (2 steps). Do NOT invent CoinGecko search URLs.
If the user did not provide a concrete HTTPS URL, do not invent one. Prefer analysis/reporter or a verified external agent instead.

${AGENT_CONTEXT_HEADER}
`.trim();

export function createPlanRouter(
  overrides: Partial<PlanRouterDeps> = {},
): Hono {
  const deps: PlanRouterDeps = {
    anthropic: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }),
    env,
    addresses: { orchestrator: addresses.orchestrator },
    readNextConfigId: () => agentRegistryContract.read.nextConfigId(),
    readAgent: (configId) => agentRegistryContract.read.get([configId]),
    readRequestDeposit: () =>
      publicClient.readContract({
        address: deployment.agentsApi as `0x${string}`,
        abi: [
          {
            type: "function",
            name: "getRequestDeposit",
            stateMutability: "view",
            inputs: [],
            outputs: [{ name: "", type: "uint256" }],
          },
        ],
        functionName: "getRequestDeposit",
      }),
    savePlanRequest,
    listExternalAgents,
    capabilityNameById,
    plannerBudgetGuard: createAnthropicBudgetGuard(env),
    ...overrides,
  };

  const router = new Hono();

  router.post("/", async (c) => {
    // Optional shared secret — strongly recommended in production
    if (deps.env.PLAN_SECRET) {
      if (c.req.header("x-plan-secret") !== deps.env.PLAN_SECRET) {
        return c.json({ error: "unauthorized" }, 401);
      }
    }

    // IP-based rate limit: 10 req/min
    const ip = getClientIp(c, deps.env);
    if (!checkRateLimit(ip)) {
      return c.json({ error: "rate limit exceeded, try again in 60s" }, 429);
    }

    let body: z.infer<typeof PlanBodySchema>;
    try {
      body = PlanBodySchema.parse(await c.req.json());
    } catch {
      return c.json({ error: "invalid request body" }, 400);
    }

    const { goal, personalAgentId, budgetWei } = body;
    const budgetEth = formatEther(BigInt(budgetWei));
    const totalBudget = BigInt(budgetWei);

    let costLines = FALLBACK_COST_LINES;
    let cheapestCostWei = FALLBACK_CHEAPEST_COST_WEI;
    try {
      const costContext = await buildPlannerCostContext(deps);
      if (costContext.costLines) costLines = costContext.costLines;
      if (costContext.cheapestCostWei > 0n) {
        cheapestCostWei = costContext.cheapestCostWei;
      }
    } catch (e) {
      console.warn("[plan] cost context read failed, using defaults:", e);
    }
    const cheapestCostEth = formatEther(cheapestCostWei || 1n);
    const maxAffordableSteps =
      cheapestCostWei > 0n
        ? Number((totalBudget + cheapestCostWei - 1n) / cheapestCostWei)
        : 1;

    // Read verified external agents from the DB-backed registry cache.
    let agentContext = AGENT_CONTEXT;
    try {
      const externalAgents = (await deps.listExternalAgents({
        activeOnly: true,
        verifiedOnly: true,
      }))
        .sort((a, b) => Number(a.config_id) - Number(b.config_id))
        .slice(0, 50);

      const externalLines = await Promise.all(
        externalAgents.map(async (agent) =>
          renderExternalAgent(agent, deps.capabilityNameById, deps.readAgent),
        ),
      );
      const populatedLines = externalLines.filter(Boolean);
      if (populatedLines.length > 0) {
        agentContext += `\n\nAdditional verified external agents:\n${populatedLines.join("\n")}`;
      }
    } catch {
      /* registry read failure is non-fatal */
    }

    const systemPrompt = buildSystemPrompt(
      agentContext,
      costLines,
      budgetEth,
      cheapestCostEth,
      Math.max(1, maxAffordableSteps),
    );

    let steps: StepSpec[] | null = null;
    let onChainSteps: {
      subAgentConfigId: bigint;
      payload: `0x${string}`;
      maxCostWei: bigint;
      timeoutSeconds: number;
    }[] | null = null;
    let totalEstimated = 0n;

    for (let attempt = 0; attempt < 2; attempt++) {
      const plannerGoal =
        attempt === 0
          ? goal
          : `${goal}\n\n[Hard constraint: total step costs must be <= ${budgetEth} STT. Use at most ${Math.max(1, maxAffordableSteps)} step(s). Prefer the cheapest configId.]`;
      const plannerSystem =
        attempt === 0
          ? systemPrompt
          : `${systemPrompt}

RETRY: Your previous plan exceeded the ${budgetEth} STT budget (cost was ${formatEther(totalEstimated)} STT).
You MUST return fewer or cheaper steps. The sum of exact authorization costs cannot exceed ${budgetEth} STT.`;

      try {
        const msg = await createPlannerMessage(deps, plannerSystem, plannerGoal);
        const raw =
          msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
        steps = parsePlannerStepsJson(raw);
      } catch (e) {
        console.error("[plan] planner failed:", e);
        return c.json({ error: "planner failed" }, 500);
      }

      try {
        onChainSteps = await normalizePlanSteps(deps, steps);
      } catch (error) {
        return c.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "planner selected invalid agents",
          },
          422,
        );
      }

      totalEstimated = onChainSteps.reduce((sum, s) => sum + s.maxCostWei, 0n);
      if (totalEstimated <= totalBudget) break;
    }

    if (!steps || !onChainSteps || totalEstimated > totalBudget) {
      return c.json(
        {
          error: "planned step costs exceed task budget",
          estimatedCostWei: totalEstimated.toString(),
          budgetWei,
        },
        422,
      );
    }

    const createTaskCalldata = encodeFunctionData({
      abi: AgentOrchestratorAbi,
      functionName: "createTask",
      args: [
        BigInt(personalAgentId),
        onChainSteps,
        totalBudget,
        PlanMode.ClaudePlan,
      ],
    });

    await deps.savePlanRequest(
      personalAgentId,
      goal,
      JSON.stringify(
        onChainSteps.map((step, index) => ({
          configId: Number(step.subAgentConfigId),
          payload: steps[index].payload,
          maxCostWei: step.maxCostWei.toString(),
          timeoutSeconds: step.timeoutSeconds,
        })),
      ),
      budgetWei,
    );

    return c.json({
      steps: onChainSteps.map((step, index) => ({
        configId: Number(step.subAgentConfigId),
        payload: steps[index].payload,
        maxCostWei: step.maxCostWei.toString(),
        timeoutSeconds: step.timeoutSeconds,
      })),
      createTaskCalldata,
      orchestrator: deps.addresses.orchestrator,
      estimatedCostWei: totalEstimated.toString(),
      budgetWei,
    });
  });

  return router;
}

async function normalizePlanSteps(
  deps: PlanRouterDeps,
  steps: StepSpec[],
): Promise<
  {
    subAgentConfigId: bigint;
    payload: `0x${string}`;
    maxCostWei: bigint;
    timeoutSeconds: number;
  }[]
> {
  const nextConfigId = await deps.readNextConfigId();
  const requestDeposit = await deps.readRequestDeposit();

  return Promise.all(
    steps.map(async (step) => {
      const configId = BigInt(step.configId);
      if (configId >= nextConfigId) {
        throw new Error(`planner selected unknown configId ${step.configId}`);
      }
      if (
        step.configId === NativeConfigId.JANICE ||
        step.configId === NativeConfigId.EXECUTOR
      ) {
        throw new Error(`planner selected reserved configId ${step.configId}`);
      }

      const agent = await deps.readAgent(configId);
      if (!agent.name || !agent.isActive || agent.suspended) {
        throw new Error(`planner selected inactive configId ${step.configId}`);
      }

      const isNative = agent.lane === AgentLane.SomniaNative;
      const exactCostWei = isNative
        ? requestDeposit + agent.costWei * 3n
        : agent.costWei;

      // Native steps go straight to the Somnia Agents API and MUST be ABI-encoded
      // per the target base agent's signature; external agents keep raw UTF-8 bytes.
      const payload = encodeStepPayload(step.configId, step.payload, isNative);

      return {
        subAgentConfigId: configId,
        payload,
        maxCostWei: exactCostWei,
        timeoutSeconds: step.timeoutSeconds,
      };
    }),
  );
}

async function renderExternalAgent(
  agent: ExternalAgentRecord,
  capabilityNames: Map<string, string>,
  readAgent: (configId: bigint) => Promise<AgentRecord>,
): Promise<string | null> {
  try {
    const chainAgent = await readAgent(BigInt(agent.config_id));
    if (!chainAgent.isActive || chainAgent.suspended) return null;
    const caps = agent.capabilities
      .map((cap) => capabilityNames.get(cap.toLowerCase()) ?? cap)
      .join(", ");
    const capSuffix = caps ? ` capabilities=${caps}.` : "";
    return `- configId ${agent.config_id} (${chainAgent.name}): external HTTP agent. cost=${formatEther(chainAgent.costWei)} STT.${capSuffix} payload=plain text`;
  } catch {
    return null;
  }
}

async function createPlannerMessage(
  deps: PlanRouterDeps,
  systemPrompt: string,
  goal: string,
) {
  const model = "claude-haiku-4-5-20251001";
  const maxAttempts = 3;
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt++;
    deps.plannerBudgetGuard.ensureRequestAllowed();
    try {
      const msg = await deps.anthropic.messages.create({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: goal }],
      });
      deps.plannerBudgetGuard.recordUsage(
        (msg as { usage?: unknown }).usage,
        model,
      );
      return msg;
    } catch (error) {
      lastError = error;
      deps.plannerBudgetGuard.noteFailure(error);
      if (attempt >= maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }

  throw lastError ?? new Error("planner failed");
}
