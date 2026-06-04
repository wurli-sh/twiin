import { Hono } from "hono";
import type { Context } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import { encodeFunctionData, formatEther, toHex } from "viem";
import { AgentOrchestratorAbi, NativeConfigId, PlanMode } from "@twiin/shared";
import { z } from "zod";
import type { IncomingMessage } from "http";
import { env, type Env } from "../env";
import { createAnthropicBudgetGuard } from "../budget";
import {
  addresses,
  agentRegistryContract,
  capabilityNameById,
} from "../contracts";
import { listExternalAgents, savePlanRequest } from "../db";

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
  maxCostWei: z.string().regex(/^[0-9]+$/, "must be decimal wei string"),
  timeoutSeconds: z.number().int().min(60).max(600),
});
const StepsOutputSchema = z.array(StepSpecSchema).min(1).max(6);

type StepSpec = z.infer<typeof StepSpecSchema>;

type AgentRecord = {
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

const AGENT_CONTEXT = `
Available sub-agents (use their configId):
- configId ${NativeConfigId.WEB_INTEL} (web-intel@twiin): Scrapes web content. cost=0.33 STT. payload=JSON {"url":"...","query":"..."}
- configId ${NativeConfigId.ORACLE} (somnia-oracle@twiin): Fetches JSON from an API. cost=0.12 STT. payload=JSON {"url":"...","path":"..."}
- configId ${NativeConfigId.ANALYSIS} (analysis-bot@twiin): Analyzes text/data, produces insights. cost=0.24 STT. payload=plain text instruction
- configId ${NativeConfigId.REPORTER} (reporter-bot@twiin): Writes a final report from data. cost=0.24 STT. payload=plain text instruction

Rules:
- Max 6 steps total.
- Steps run sequentially; each step can reference "previous results" in its payload.
- timeoutSeconds must be between 60 and 600.
- maxCostWei is the max you authorize for that step (in wei, as decimal string).
- Do NOT use configId 0 (janice) or configId 5 (executor) — they are reserved.
- Return ONLY a valid JSON array with no markdown or explanation.
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

    const systemPrompt = `You are a planner for the Twiin AI agent system on the Somnia blockchain.
Given a user goal, decompose it into at most 6 sequential steps using the available sub-agents.
The user's budget is ${budgetEth} STT total.

${agentContext}

Return a JSON array of step objects with this exact shape:
[{"configId": number, "payload": "string", "maxCostWei": "decimal string", "timeoutSeconds": number}]`;

    let steps: StepSpec[];
    try {
      const msg = await createPlannerMessage(deps, systemPrompt, goal);

      const raw =
        msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
      const jsonStr = raw
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      steps = StepsOutputSchema.parse(JSON.parse(jsonStr));
    } catch (e) {
      console.error("[plan] planner failed:", e);
      return c.json({ error: "planner failed" }, 500);
    }

    const onChainSteps = steps.map((s) => ({
      subAgentConfigId: BigInt(s.configId),
      payload: toHex(new TextEncoder().encode(s.payload)),
      maxCostWei: BigInt(s.maxCostWei),
      timeoutSeconds: s.timeoutSeconds,
    }));

    const totalEstimated = onChainSteps.reduce(
      (sum, s) => sum + s.maxCostWei,
      0n,
    );
    const totalBudget = BigInt(budgetWei);

    if (totalEstimated > totalBudget) {
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
      JSON.stringify(steps),
      budgetWei,
    );

    return c.json({
      steps,
      createTaskCalldata,
      orchestrator: deps.addresses.orchestrator,
      estimatedCostWei: totalEstimated.toString(),
      budgetWei,
    });
  });

  return router;
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
