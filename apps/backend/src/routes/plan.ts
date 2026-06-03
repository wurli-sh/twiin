import { Hono } from "hono";
import type { Context } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import { encodeFunctionData, formatEther, toHex } from "viem";
import { AgentOrchestratorAbi, NativeConfigId, PlanMode } from "@twiin/shared";
import { z } from "zod";
import type { IncomingMessage } from "http";
import { env } from "../env";
import { addresses, agentRegistryContract } from "../contracts";
import { savePlanRequest } from "../db";

export const planRouter = new Hono();

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// Fixed-window rate limiter — 10 req/min per IP, with expired-entry eviction
const rateWindows = new Map<string, { count: number; resetAt: number }>();

function getClientIp(c: Context): string {
  if (env.TRUST_PROXY) {
    const xff = c.req.header("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
  }
  // Use real socket address — cannot be spoofed by client headers
  const incoming = (c.env as { incoming?: IncomingMessage }).incoming;
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

planRouter.post("/", async (c) => {
  // Optional shared secret — strongly recommended in production
  if (env.PLAN_SECRET) {
    if (c.req.header("x-plan-secret") !== env.PLAN_SECRET) {
      return c.json({ error: "unauthorized" }, 401);
    }
  }

  // IP-based rate limit: 10 req/min
  const ip = getClientIp(c);
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

  // Read available external agents from registry (cap at 50 to bound RPC calls)
  let agentContext = AGENT_CONTEXT;
  try {
    const nextConfigId = await agentRegistryContract.read.nextConfigId();
    const maxId = nextConfigId > 56n ? 56n : nextConfigId; // 6 + 50 cap
    const externalAgents: string[] = [];
    const ids = Array.from(
      { length: Number(maxId - 6n) },
      (_, i) => BigInt(i) + 6n,
    );
    await Promise.all(
      ids.map(async (id) => {
        try {
          const agent = await agentRegistryContract.read.get([id]);
          if (agent.isActive && !agent.suspended) {
            externalAgents.push(
              `- configId ${id} (${agent.name}): external HTTP agent. cost=${formatEther(agent.costWei)} STT. payload=plain text`,
            );
          }
        } catch {
          /* ignore */
        }
      }),
    );
    if (externalAgents.length > 0) {
      agentContext += `\n\nAdditional external agents:\n${externalAgents.join("\n")}`;
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
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: goal }],
    });

    const raw =
      msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
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

  await savePlanRequest(
    personalAgentId,
    goal,
    JSON.stringify(steps),
    budgetWei,
  );

  return c.json({
    steps,
    createTaskCalldata,
    orchestrator: addresses.orchestrator,
    estimatedCostWei: totalEstimated.toString(),
    budgetWei,
  });
});
