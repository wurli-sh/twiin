import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import { encodeFunctionData, formatEther, parseEther } from "viem";
import {
  AgentLane,
  AgentOrchestratorAbi,
  buildConfigIdByName,
  buildGenericTemplates,
  buildConsoleGoalTemplates,
  encodeStepPayload,
  isChainActivityGoal,
  isEcosystemHealthGoal,
  isLpRiskOracleGoal,
  isReceiptAuditGoal,
  NativeConfigId,
  PlanError,
  PlanErrorCode,
  PlanMode,
  MAX_CONSOLE_TEMPLATE_STEPS,
  resolveTemplateSteps,
  validateExternalAgentPayload,
} from "@twiin/shared";
import { z } from "zod";
import type { IncomingMessage } from "http";
import { AgentCatalog } from "../agent-catalog";
import { env, type Env } from "../env";
import { createAnthropicBudgetGuard } from "../budget";
import {
  addresses,
  agentRegistryContract,
  capabilityNameById,
  deployment,
} from "../contracts";
import { publicClient } from "../clients";
import {
  getPlanRequest,
  listExternalAgents,
  savePlanRequest,
  type PlanRequestSource,
} from "../db";
import {
  parsePlannerStepsFromToolInput,
  parsePlannerStepsJson,
} from "../planner-json";
import { verifyExternalAgentsNow } from "../keepers/externals";
import { verifyExternalAgentCacheEntry } from "../keepers/relay";
import { logTaskApi, logTaskTimeline } from "../task-log";

const rateWindows = new Map<string, { count: number; resetAt: number }>();

function getClientIp(c: Context, config: Pick<Env, "TRUST_PROXY">): string {
  if (config.TRUST_PROXY) {
    const xff = c.req.header("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
  }
  const incoming = (c.env as { incoming?: IncomingMessage } | undefined)
    ?.incoming;
  return incoming?.socket?.remoteAddress ?? "unknown";
}

function checkRateLimit(ip: string): { ok: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  for (const [key, entry] of rateWindows) {
    if (entry.resetAt < now) rateWindows.delete(key);
  }
  const entry = rateWindows.get(ip);
  if (!entry) {
    rateWindows.set(ip, { count: 1, resetAt: now + 60_000 });
    return { ok: true };
  }
  if (entry.count >= 10) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }
  entry.count++;
  return { ok: true };
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

type StepSpec = z.infer<typeof StepSpecSchema>;

type AgentRecord = {
  lane: number;
  isActive: boolean;
  suspended: boolean;
  name: string;
  costWei: bigint;
  capabilities?: readonly `0x${string}`[];
};

type PlannerContentBlock = {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
};

type PlannerMessage = {
  content: PlannerContentBlock[];
  usage?: unknown;
  stop_reason?: string | null;
};

export type PlanRouterDeps = {
  anthropic: Pick<Anthropic, "messages">;
  env: Env;
  addresses: { orchestrator: `0x${string}` };
  readNextConfigId: () => Promise<bigint>;
  readAgent: (configId: bigint) => Promise<AgentRecord>;
  readRequestDeposit: () => Promise<bigint>;
  savePlanRequest: typeof savePlanRequest;
  listExternalAgents: typeof listExternalAgents;
  capabilityNameById: Map<string, string>;
  agentCatalog: AgentCatalog;
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

const FALLBACK_COST_LINES = [
  `- configId ${NativeConfigId.ORACLE} (somnia-oracle@twiin): exact authorization ~0.12 STT`,
  `- configId ${NativeConfigId.ANALYSIS} (analysis-bot@twiin): exact authorization ~0.24 STT`,
  `- configId ${NativeConfigId.REPORTER} (reporter-bot@twiin): exact authorization ~0.24 STT`,
].join("\n");

const FALLBACK_CHEAPEST_COST_WEI = parseEther("0.12");

const SUBMIT_PLAN_TOOL = {
  name: "submit_plan",
  description:
    "Submit the sequential execution plan as structured steps for on-chain dispatch.",
  input_schema: {
    type: "object",
    properties: {
      steps: {
        type: "array",
        minItems: 1,
        maxItems: MAX_CONSOLE_TEMPLATE_STEPS,
        items: {
          type: "object",
          properties: {
            configId: { type: "integer", minimum: 0, maximum: 100 },
            payload: { type: "string", minLength: 1, maxLength: 4000 },
            maxCostWei: { type: "string" },
            timeoutSeconds: { type: "integer", minimum: 60, maximum: 600 },
          },
          required: ["configId", "payload", "timeoutSeconds"],
        },
      },
    },
    required: ["steps"],
  },
} as const;

const AGENT_CONTEXT_HEADER = `
Rules:
- Max ${MAX_CONSOLE_TEMPLATE_STEPS} steps total — plans with more are rejected.
- Use the fewest steps that still corroborate; never pad with redundant agents.
- Steps run sequentially; each step can reference "previous results" in its payload.
- timeoutSeconds must be between 60 and 600.
- maxCostWei will be normalized server-side to the exact contract-required authorization. Still return a reasonable decimal wei string.
- Do NOT use configId 0 (janice) or configId 5 (executor) — they are reserved.
- Never ask downstream agents to invent dates, prices, market caps, sentiment drivers, or any other facts that are not present in prior step outputs.
- If the current date is not explicitly provided by a previous step, omit the date rather than guessing one.
- If a required value is unavailable from previous results, instruct the downstream agent to say "unavailable" instead of fabricating it.
- Call submit_plan with the steps array. Do not return prose outside the tool call.
`.trim();

async function buildPlannerCostContext(deps: PlanRouterDeps): Promise<{
  costLines: string;
  cheapestCostWei: bigint;
}> {
  const agents = await deps.agentCatalog.getAgentsForPlanner();
  if (agents.length === 0) {
    return { costLines: FALLBACK_COST_LINES, cheapestCostWei: FALLBACK_CHEAPEST_COST_WEI };
  }
  let cheapest = 0n;
  const lines = agents.map((agent) => {
    if (cheapest === 0n || agent.exactCostWei < cheapest) {
      cheapest = agent.exactCostWei;
    }
    return `- configId ${agent.configId} (${agent.name}): exact authorization ${formatEther(agent.exactCostWei)} STT`;
  });
  return { costLines: lines.join("\n"), cheapestCostWei: cheapest };
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

Call submit_plan with steps shaped as:
{"steps":[{"configId": number, "payload": "string", "maxCostWei": "decimal string", "timeoutSeconds": number}]}`;
}

async function estimateTemplateCost(
  deps: PlanRouterDeps,
  steps: StepSpec[],
): Promise<bigint> {
  const requestDeposit = await deps.readRequestDeposit();
  let total = 0n;
  for (const step of steps) {
    const agent = await deps.readAgent(BigInt(step.configId));
    const isNative = agent.lane === AgentLane.SomniaNative;
    total += isNative
      ? requestDeposit + agent.costWei * 3n
      : agent.costWei;
  }
  return total;
}

const AGENT_CONTEXT = `
Available sub-agents (use their configId):
- Do NOT use configId ${NativeConfigId.WEB_INTEL} (web-intel@twiin) in any plan — web scraping is disabled for planning.
- configId ${NativeConfigId.ORACLE} (somnia-oracle@twiin): Fetches a JSON API with a DIRECT endpoint (not search/discovery).
  payload=JSON {"url":"https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd","selector":"bitcoin.usd"} for prices (selector MUST be a leaf path like coin.usd, never just the coin id). Do not use decimals with CoinGecko — fetchString returns the API value directly.
  NEVER use /search? URLs or selectors like coins.0.id — they fail when the API returns empty results.
- configId ${NativeConfigId.ANALYSIS} (analysis-bot@twiin): Analyzes text/data, produces insights. payload=plain text instruction
- configId ${NativeConfigId.REPORTER} (reporter-bot@twiin): Writes a final report from data. payload=plain text instruction

Console external agents (resolve by name in templates; use exact configId from catalog when planning manually):
- docs-lens: Official Somnia docs query (question, docPath). Uses docs.somnia.network/{docPath}.md?ask= API.
  Valid docPath examples: "readme" (default, cross-doc), "developer/building-dapps", "developer/building-dapps/example-applications/building-a-simple-dex-on-somnia".
  NEVER use invented paths like "defi" or "agents" — they 404 and hang with ?ask=.
- reactivity-lens: Somnia reactivity / OracleFeed snapshot (agentId, topic, lookbackBlocks).
- dreamdex-mcp: dreamDEX / DexScreener market data (pair, action). Actions: orderbook, pairs, snapshot, coingecko (external CoinGecko price fetch — prefer over somnia-oracle for LP corroboration).
- onchain-lens: Somnia RPC block/tx activity snapshot.
- receipt-auditor: Somnia agent receipt forensics (requestId or "latest").
- briefsmith: Publish-ready executive brief from prior step outputs (Markdown). Prefer over reporter-bot for console pipelines.

Default LP pipeline when externals are registered: dreamdex-mcp (orderbook) + docs-lens + dreamdex-mcp (coingecko) + analysis-bot + briefsmith. Do not use somnia-oracle unless the user explicitly requests native/on-chain oracle verification — native oracle depends on Somnia validator callbacks and may timeout on testnet.
If the user did not provide a concrete HTTPS URL, do not invent one. Prefer dreamdex-mcp coingecko, analysis-bot, or a verified external agent instead.

For verification goals (stats, sentiment, market snapshots): never rely on a single source. Corroborate across docs-lens + somnia-oracle (JSON) + analysis-bot synthesis.

${AGENT_CONTEXT_HEADER}
`.trim();

const SOMNIA_SENTIMENT_SOURCE_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=somnia&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true";

function isSomniaSentimentGoal(goal: string): boolean {
  const lower = goal.toLowerCase();
  return lower.includes("somnia") && lower.includes("sentiment");
}

function isSomniaStatsGoal(goal: string): boolean {
  const lower = goal.toLowerCase();
  if (!lower.includes("somnia")) return false;
  return (
    lower.includes("stats") ||
    lower.includes("ecosystem stats") ||
    lower.includes("market snapshot") ||
    lower.includes("price") ||
    lower.includes("24h change") ||
    lower.includes("market cap") ||
    lower.includes("24h volume")
  );
}

function somniaSentimentOracleStep(selector: string): StepSpec {
  return {
    configId: NativeConfigId.ORACLE,
    payload: JSON.stringify({
      url: SOMNIA_SENTIMENT_SOURCE_URL,
      selector,
    }),
    maxCostWei: "0",
    timeoutSeconds: 90,
  };
}

type PlanTemplateResult = {
  steps: StepSpec[];
  verificationTier: "corroborated" | "single";
  source: PlanRequestSource;
};

function buildSomniaCorroboratedTemplate(): PlanTemplateResult {
  return {
    source: "template",
    verificationTier: "corroborated",
    steps: [
      somniaSentimentOracleStep("somnia.usd"),
      {
        configId: NativeConfigId.ANALYSIS,
        payload:
          "Corroborate ONLY prior step JSON oracle/market fields. Extract price, 24h change, and market cap from the prior output. If key numerics are missing or inconsistent, set confidence <= 50. If present and consistent, confidence >= 85. Output JSON: {confidence, priceUsd, change24h, marketCapUsd, agreementNotes}.",
        maxCostWei: "0",
        timeoutSeconds: 120,
      },
      {
        configId: NativeConfigId.REPORTER,
        payload:
          "Write a concise Somnia stats/sentiment snapshot for the user using ONLY prior step outputs. Include the confidence score from the analysis step.",
        maxCostWei: "0",
        timeoutSeconds: 120,
      },
    ],
  };
}

function buildSomniaSentimentFallbackTemplate(): PlanTemplateResult {
  return {
    source: "template",
    verificationTier: "single",
    steps: [
      somniaSentimentOracleStep("somnia.usd"),
      {
        configId: NativeConfigId.REPORTER,
        payload:
          'Write a concise Somnia sentiment snapshot for the user using ONLY prior step outputs. Include price and 24h change. Oracle values are decimal strings in USD — use them exactly as given, do not rescale. State clearly that this is a lower-budget single-source oracle summary and avoid implying multi-source verification.',
        maxCostWei: "0",
        timeoutSeconds: 120,
      },
    ],
  };
}

function buildSomniaStatsFallbackTemplate(): PlanTemplateResult {
  return {
    source: "template",
    verificationTier: "single",
    steps: [
      somniaSentimentOracleStep("somnia.usd"),
      {
        configId: NativeConfigId.REPORTER,
        payload:
          "Write a concise Somnia stats snapshot for the user using ONLY prior step outputs. Include price, 24h change, market cap, and 24h volume. Oracle values are decimal strings in USD — use them exactly as given, do not rescale. State clearly that this is a lower-budget single-source oracle summary.",
        maxCostWei: "0",
        timeoutSeconds: 120,
      },
    ],
  };
}

function buildSomniaTemplates(goal: string): PlanTemplateResult[] {
  if (isSomniaSentimentGoal(goal)) {
    return [
      buildSomniaCorroboratedTemplate(),
      buildSomniaSentimentFallbackTemplate(),
    ];
  }
  return [buildSomniaCorroboratedTemplate(), buildSomniaStatsFallbackTemplate()];
}

async function buildAllTemplates(
  deps: PlanRouterDeps,
  goal: string,
): Promise<PlanTemplateResult[]> {
  const generic = buildGenericTemplates(goal).map((template) => ({
    source: "template" as const,
    verificationTier: template.verificationTier,
    steps: template.steps as StepSpec[],
  }));

  const candidates = await deps.agentCatalog.loadCandidates();
  const configIdByName = buildConfigIdByName(
    candidates.map((agent) => ({
      name: agent.name,
      configId: agent.configId,
    })),
  );

  const consoleGoal: PlanTemplateResult[] = [];
  for (const template of buildConsoleGoalTemplates(goal)) {
    const resolved = resolveTemplateSteps(template.steps, configIdByName);
    if (resolved) {
      consoleGoal.push({
        source: "template",
        verificationTier: template.verificationTier,
        steps: resolved,
      });
    }
  }
  if (consoleGoal.length > 0) {
    return [...consoleGoal, ...generic];
  }

  if (isSomniaSentimentGoal(goal) || isSomniaStatsGoal(goal)) {
    return [...buildSomniaTemplates(goal), ...generic];
  }
  return generic;
}

function planErrorResponse(error: PlanError) {
  return error.body;
}

const EXTERNAL_HEALTH_TTL_SECONDS = 300;

function isConsoleGoal(goal: string): boolean {
  return (
    isLpRiskOracleGoal(goal) ||
    isEcosystemHealthGoal(goal) ||
    isReceiptAuditGoal(goal) ||
    isChainActivityGoal(goal)
  );
}

async function needsExternalVerification(
  deps: PlanRouterDeps,
): Promise<boolean> {
  try {
    const agents = await deps.listExternalAgents({ activeOnly: true });
    const now = Math.floor(Date.now() / 1000);
    return agents.some(
      (agent) =>
        agent.is_verified !== 1 ||
        agent.last_verified_at == null ||
        now - agent.last_verified_at >= EXTERNAL_HEALTH_TTL_SECONDS,
    );
  } catch {
    return false;
  }
}

function externalVerificationChanged(
  before: Awaited<ReturnType<typeof listExternalAgents>>,
  after: Awaited<ReturnType<typeof listExternalAgents>>,
): boolean {
  return before.some((row) => {
    const next = after.find((agent) => agent.config_id === row.config_id);
    return (
      next != null &&
      (next.is_verified !== row.is_verified ||
        next.last_verified_at !== row.last_verified_at)
    );
  });
}

async function ensureFreshExternalAgents(deps: PlanRouterDeps): Promise<void> {
  if (!(await needsExternalVerification(deps))) return;

  const before = await deps.listExternalAgents({ activeOnly: true });
  try {
    await verifyExternalAgentsNow();
    const after = await deps.listExternalAgents({ activeOnly: true });
    if (externalVerificationChanged(before, after)) {
      deps.agentCatalog.invalidate();
    }
  } catch (error) {
    console.warn("[plan] external pre-verify failed (non-fatal):", error);
  }
}

async function buildConsoleTemplateGuidance(
  deps: PlanRouterDeps,
  goal: string,
): Promise<string> {
  const candidates = await deps.agentCatalog.loadCandidates();
  const configIdByName = buildConfigIdByName(
    candidates.map((agent) => ({
      name: agent.name,
      configId: agent.configId,
    })),
  );

  const lines: string[] = [];
  for (const template of buildConsoleGoalTemplates(goal)) {
    const resolved = resolveTemplateSteps(template.steps, configIdByName);
    if (!resolved) continue;
    lines.push(
      `- Pipeline "${template.label}" (${template.verificationTier} verification): ${JSON.stringify(resolved)}`,
    );
  }

  if (lines.length === 0) return "";
  return `\n\nRecommended console pipelines for this goal:\n${lines.join("\n")}\nFollow the closest matching pipeline unless the user goal clearly requires a different decomposition. Use exact configIds from the catalog above.`;
}

async function tryTemplateMatch(
  deps: PlanRouterDeps,
  goal: string,
  opts: {
    totalBudget: bigint;
    budgetWei: string;
    substitutions: Array<{ from: number; to: number }>;
    allowBudgetExceeded?: boolean;
  },
): Promise<{
  matched: boolean;
  steps: StepSpec[] | null;
  onChainSteps: Awaited<ReturnType<typeof normalizePlanSteps>> | null;
  totalEstimated: bigint;
  verificationTier: "corroborated" | "single";
  planSource: PlanRequestSource;
}> {
  let steps: StepSpec[] | null = null;
  let onChainSteps: Awaited<ReturnType<typeof normalizePlanSteps>> | null = null;
  let totalEstimated = 0n;
  let verificationTier: "corroborated" | "single" = "single";
  let planSource: PlanRequestSource = "llm";
  let cheapestEstimate: bigint | null = null;
  let cheapestStepCount = 0;

  for (const candidate of await buildAllTemplates(deps, goal)) {
    let roughEstimate: bigint | null = null;
    try {
      roughEstimate = await estimateTemplateCost(deps, candidate.steps);
      if (cheapestEstimate == null || roughEstimate < cheapestEstimate) {
        cheapestEstimate = roughEstimate;
        cheapestStepCount = candidate.steps.length;
      }
    } catch {
      /* skip unpriceable templates */
    }

    try {
      const normalized = await normalizePlanSteps(deps, candidate.steps, {
        totalBudget: opts.totalBudget,
        substitutions: opts.substitutions,
      });
      const estimated = normalized.reduce((sum, s) => sum + s.maxCostWei, 0n);
      if (cheapestEstimate == null || estimated < cheapestEstimate) {
        cheapestEstimate = estimated;
        cheapestStepCount = normalized.length;
      }
      if (estimated <= opts.totalBudget) {
        steps = candidate.steps;
        onChainSteps = normalized;
        totalEstimated = estimated;
        verificationTier = candidate.verificationTier;
        planSource = candidate.source;
        return {
          matched: true,
          steps,
          onChainSteps,
          totalEstimated,
          verificationTier,
          planSource,
        };
      }
    } catch (error) {
      if (error instanceof PlanError && error.code === PlanErrorCode.NO_CAPABLE_AGENT) {
        throw error;
      }
    }
  }

  if (cheapestEstimate != null && cheapestEstimate > opts.totalBudget) {
    if (opts.allowBudgetExceeded) {
      return {
        matched: false,
        steps,
        onChainSteps,
        totalEstimated,
        verificationTier,
        planSource,
      };
    }
    throw new PlanError(
      PlanErrorCode.BUDGET_EXCEEDED,
      "planned step costs exceed task budget",
      422,
      {
        estimatedCostWei: cheapestEstimate.toString(),
        budgetWei: opts.budgetWei,
        requiredStepCount: cheapestStepCount,
        suggestedBudgetWei: cheapestEstimate.toString(),
      },
    );
  }

  return {
    matched: false,
    steps,
    onChainSteps,
    totalEstimated,
    verificationTier,
    planSource,
  };
}

export function createPlanRouter(
  overrides: Partial<PlanRouterDeps> = {},
): Hono {
  const baseDeps = {
    anthropic: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }),
    env,
    addresses: { orchestrator: addresses.orchestrator },
    readNextConfigId: () => agentRegistryContract.read.nextConfigId(),
    readAgent: (configId: bigint) => agentRegistryContract.read.get([configId]),
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
  };

  const usesInjectedReadAgent = overrides.readAgent !== undefined;

  const deps: PlanRouterDeps = {
    ...baseDeps,
    ...overrides,
    agentCatalog:
      overrides.agentCatalog ??
      new AgentCatalog({
        readNextConfigId:
          overrides.readNextConfigId ?? baseDeps.readNextConfigId,
        readAgent: overrides.readAgent ?? baseDeps.readAgent,
        readRequestDeposit:
          overrides.readRequestDeposit ?? baseDeps.readRequestDeposit,
        readByCapability: usesInjectedReadAgent
          ? async () => []
          : (cap) => agentRegistryContract.read.getByCapability([cap]),
        listExternalAgents: overrides.listExternalAgents ?? listExternalAgents,
        capabilityNameById,
      }),
  };

  const router = new Hono();

  router.get("/:planId", async (c) => {
    const row = await getPlanRequest(c.req.param("planId"));
    if (!row) return c.json({ error: "plan not found" }, 404);
    return c.json({
      planId: row.plan_id,
      personalAgentId: row.personal_agent_id,
      goal: row.goal,
      steps: JSON.parse(row.steps_json),
      budgetWei: row.budget_wei,
      source: row.source,
      attempts: row.attempts,
      verificationTier: row.verification_tier,
      substitutions: row.substitutions_json
        ? JSON.parse(row.substitutions_json)
        : [],
      createdAt: row.created_at,
    });
  });

  router.post("/", async (c) => {
    if (deps.env.PLAN_SECRET) {
      if (c.req.header("x-plan-secret") !== deps.env.PLAN_SECRET) {
        return c.json({ error: "unauthorized" }, 401);
      }
    }

    const ip = getClientIp(c, deps.env);
    const rate = checkRateLimit(ip);
    if (!rate.ok) {
      const err = new PlanError(
        PlanErrorCode.RATE_LIMITED,
        "rate limit exceeded, try again in 60s",
        429,
        { retryAfterSeconds: rate.retryAfterSeconds },
      );
      return c.json(planErrorResponse(err), 429);
    }

    let body: z.infer<typeof PlanBodySchema>;
    try {
      body = PlanBodySchema.parse(await c.req.json());
    } catch {
      const err = new PlanError(
        PlanErrorCode.INVALID_REQUEST,
        "invalid request body",
        400,
      );
      return c.json(planErrorResponse(err), 400);
    }

    const { goal, personalAgentId, budgetWei } = body;
    const planStartedAt = Date.now();
    logTaskApi("/api/plan", {
      personalAgentId,
      budgetWei,
      goalPreview: goal.slice(0, 160),
    });
    const budgetEth = formatEther(BigInt(budgetWei));
    const totalBudget = BigInt(budgetWei);

    let costLines = FALLBACK_COST_LINES;
    let cheapestCostWei = FALLBACK_CHEAPEST_COST_WEI;
    const costContextStartedAt = Date.now();
    try {
      const costContext = await buildPlannerCostContext(deps);
      if (costContext.costLines) costLines = costContext.costLines;
      if (costContext.cheapestCostWei > 0n) {
        cheapestCostWei = costContext.cheapestCostWei;
      }
    } catch (e) {
      console.warn("[plan] cost context read failed, using defaults:", e);
    }
    logTaskTimeline("plan_timing", {
      phase: "cost_context",
      ms: Date.now() - costContextStartedAt,
      goalPreview: goal.slice(0, 80),
    });
    const cheapestCostEth = formatEther(cheapestCostWei || 1n);
    const maxAffordableSteps =
      cheapestCostWei > 0n
        ? Number((totalBudget + cheapestCostWei - 1n) / cheapestCostWei)
        : 1;

    if (isConsoleGoal(goal)) {
      await ensureFreshExternalAgents(deps);
    }

    let agentContext = AGENT_CONTEXT;
    try {
      const catalogContext = await deps.agentCatalog.renderPlannerContext();
      if (catalogContext) {
        agentContext += `\n\nHealthy agents from catalog:\n${catalogContext}`;
      }
    } catch {
      /* non-fatal */
    }

    const templateGuidanceStartedAt = Date.now();
    let templateGuidance = "";
    if (isConsoleGoal(goal)) {
      try {
        templateGuidance = await buildConsoleTemplateGuidance(deps, goal);
      } catch (error) {
        console.warn("[plan] template guidance failed (non-fatal):", error);
      }
    }
    logTaskTimeline("plan_timing", {
      phase: "template_guidance",
      ms: Date.now() - templateGuidanceStartedAt,
      goalPreview: goal.slice(0, 80),
    });

    const systemPrompt =
      buildSystemPrompt(
        agentContext,
        costLines,
        budgetEth,
        cheapestCostEth,
        Math.min(
          Math.max(1, maxAffordableSteps),
          MAX_CONSOLE_TEMPLATE_STEPS,
        ),
      ) + templateGuidance;

    let steps: StepSpec[] | null = null;
    let onChainSteps: Awaited<ReturnType<typeof normalizePlanSteps>> | null =
      null;
    let totalEstimated = 0n;
    let verificationTier: "corroborated" | "single" = "single";
    let planSource: PlanRequestSource = "llm";
    let plannerAttempts = 0;
    const substitutions: Array<{ from: number; to: number }> = [];

    const tryTemplates = async (): Promise<boolean> => {
      const result = await tryTemplateMatch(deps, goal, {
        totalBudget,
        budgetWei,
        substitutions,
      });
      if (result.matched && result.steps && result.onChainSteps) {
        steps = result.steps;
        onChainSteps = result.onChainSteps;
        totalEstimated = result.totalEstimated;
        verificationTier = result.verificationTier;
        planSource = result.planSource;
        return true;
      }
      return false;
    };

    if (isSomniaSentimentGoal(goal) || isSomniaStatsGoal(goal)) {
      try {
        const matched = await tryTemplates();
        if (!matched) {
          throw new PlanError(
            PlanErrorCode.BUDGET_EXCEEDED,
            "somnia sentiment oracle requires a higher budget",
            422,
            { budgetWei },
          );
        }
      } catch (error) {
        if (error instanceof PlanError) {
          return c.json(planErrorResponse(error), error.status as 422);
        }
        throw error;
      }
    } else if (isConsoleGoal(goal)) {
      try {
        const matched = await tryTemplates();
        if (!matched) {
          throw new PlanError(
            PlanErrorCode.NO_CAPABLE_AGENT,
            "no console template matched — register external agents (pnpm dev:agents) and ensure budget meets template minimum",
            422,
          );
        }
      } catch (error) {
        if (error instanceof PlanError) {
          return c.json(planErrorResponse(error), error.status as 422);
        }
        throw error;
      }
    }

    if (!steps || !onChainSteps) {
      if (isConsoleGoal(goal)) {
        return c.json(
          planErrorResponse(
            new PlanError(
              PlanErrorCode.NO_CAPABLE_AGENT,
              "console goal requires a curated template plan",
              422,
            ),
          ),
          422,
        );
      }
      let llmFailed = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        const plannerGoal =
          attempt === 0
            ? goal
            : `${goal}\n\n[Hard constraint: total step costs must be <= ${budgetEth} STT. Use at most ${Math.min(Math.max(1, maxAffordableSteps), MAX_CONSOLE_TEMPLATE_STEPS)} step(s). Prefer the cheapest configId.]`;
        const plannerSystem =
          attempt === 0
            ? systemPrompt
            : `${systemPrompt}

RETRY: Your previous plan exceeded the ${budgetEth} STT budget (cost was ${formatEther(totalEstimated)} STT).
You MUST return fewer or cheaper steps. The sum of exact authorization costs cannot exceed ${budgetEth} STT.`;

        try {
          plannerAttempts++;
          const claudeStartedAt = Date.now();
          steps = await parsePlannerStepsFromMessage(
            deps,
            plannerSystem,
            plannerGoal,
          );
          logTaskTimeline("plan_timing", {
            phase: "claude",
            ms: Date.now() - claudeStartedAt,
            attempt: plannerAttempts,
          });
        } catch (e) {
          console.error("[plan] planner failed:", e);
          llmFailed = true;
          break;
        }

        try {
          const normalizeStartedAt = Date.now();
          onChainSteps = await normalizePlanSteps(deps, steps, {
            totalBudget,
            substitutions,
          });
          logTaskTimeline("plan_timing", {
            phase: "normalize",
            ms: Date.now() - normalizeStartedAt,
            attempt: plannerAttempts,
            stepCount: onChainSteps.length,
          });
        } catch (error) {
          if (error instanceof PlanError) {
            return c.json(planErrorResponse(error), error.status as 422);
          }
          return c.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "planner selected invalid agents",
              code: PlanErrorCode.INVALID_REQUEST,
            },
            422,
          );
        }

        totalEstimated = onChainSteps.reduce((sum, s) => sum + s.maxCostWei, 0n);
        if (totalEstimated <= totalBudget) {
          planSource = substitutions.length > 0 ? "substituted" : "llm";
          break;
        }
        steps = null;
        onChainSteps = null;
      }

      if (!steps || !onChainSteps) {
        if (llmFailed) {
          try {
            const matched = await tryTemplates();
            if (!matched) {
              throw new PlanError(
                PlanErrorCode.PLANNER_UNAVAILABLE,
                "planner unavailable and no template matched",
                503,
              );
            }
          } catch (error) {
            if (error instanceof PlanError) {
              return c.json(planErrorResponse(error), error.status as 503 | 422);
            }
            throw error;
          }
        } else {
          const err = new PlanError(
            PlanErrorCode.BUDGET_EXCEEDED,
            "planned step costs exceed task budget",
            422,
            {
              estimatedCostWei: totalEstimated.toString(),
              budgetWei,
              suggestedBudgetWei: totalEstimated.toString(),
            },
          );
          return c.json(planErrorResponse(err), 422);
        }
      }
    }

    if (!steps || !onChainSteps || totalEstimated > totalBudget) {
      const err = new PlanError(
        PlanErrorCode.BUDGET_EXCEEDED,
        "planned step costs exceed task budget",
        422,
        {
          estimatedCostWei: totalEstimated.toString(),
          budgetWei,
          suggestedBudgetWei: totalEstimated.toString(),
        },
      );
      return c.json(planErrorResponse(err), 422);
    }

    const planId = randomUUID();
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

    await deps.savePlanRequest({
      planId,
      personalAgentId,
      goal,
      stepsJson: JSON.stringify(
        onChainSteps.map((step, index) => ({
          configId: Number(step.subAgentConfigId),
          payload: steps![index].payload,
          maxCostWei: step.maxCostWei.toString(),
          timeoutSeconds: step.timeoutSeconds,
        })),
      ),
      budgetWei,
      source: planSource,
      attempts: plannerAttempts,
      verificationTier,
      substitutionsJson:
        substitutions.length > 0 ? JSON.stringify(substitutions) : null,
    });

    if (substitutions.length > 0) {
      logTaskTimeline("plan_substitution", {
        planId,
        substitutions,
      });
    }

    logTaskTimeline("plan_timing", {
      phase: "total",
      ms: Date.now() - planStartedAt,
      source: planSource,
    });

    logTaskTimeline("plan_ready", {
      planId,
      personalAgentId,
      budgetWei,
      source: planSource,
      estimatedCostWei: totalEstimated.toString(),
      stepCount: onChainSteps.length,
      steps: onChainSteps.map((step, index) => ({
        stepIdx: index,
        configId: Number(step.subAgentConfigId),
        timeoutSeconds: step.timeoutSeconds,
        maxCostWei: step.maxCostWei.toString(),
        payloadPreview: steps![index].payload.slice(0, 160),
      })),
    });

    return c.json({
      planId,
      steps: onChainSteps.map((step, index) => ({
        configId: Number(step.subAgentConfigId),
        payload: steps![index].payload,
        maxCostWei: step.maxCostWei.toString(),
        timeoutSeconds: step.timeoutSeconds,
      })),
      createTaskCalldata,
      orchestrator: deps.addresses.orchestrator,
      estimatedCostWei: totalEstimated.toString(),
      budgetWei,
      verificationTier,
      source: planSource,
    });
  });

  return router;
}

async function parsePlannerStepsFromMessage(
  deps: PlanRouterDeps,
  systemPrompt: string,
  goal: string,
): Promise<StepSpec[]> {
  const maxParseAttempts = 3;
  let lastError: unknown;
  let userContent = goal;

  for (let parseAttempt = 0; parseAttempt < maxParseAttempts; parseAttempt++) {
    const msg = await createPlannerMessage(deps, systemPrompt, userContent);
    try {
      return extractPlannerSteps(msg);
    } catch (e) {
      lastError = e;
      const detail = e instanceof Error ? e.message : String(e);
      console.error("[plan] parse attempt failed:", {
        attempt: parseAttempt + 1,
        detail,
      });
      userContent = `${goal}\n\nYour previous output was invalid: ${detail}. Call submit_plan with a valid steps array only.`;
    }
  }

  throw lastError ?? new Error("planner parse failed");
}

function extractPlannerSteps(message: PlannerMessage): StepSpec[] {
  const toolBlock = message.content.find(
    (block) => block.type === "tool_use" && block.name === "submit_plan",
  );
  if (toolBlock?.input != null) {
    return parsePlannerStepsFromToolInput(toolBlock.input) as StepSpec[];
  }
  const raw = extractPlannerText(message);
  return parsePlannerStepsJson(raw) as StepSpec[];
}

function parseWebIntelRedirectIntent(step: StepSpec): {
  question: string;
  docPath: string;
  marketIntent: boolean;
} {
  let question = "What does the official Somnia documentation say about this topic?";
  let docPath = "readme";
  let marketIntent = false;

  try {
    const parsed = JSON.parse(step.payload) as {
      url?: unknown;
      prompt?: unknown;
      question?: unknown;
      docPath?: unknown;
    };
    if (typeof parsed.question === "string" && parsed.question.trim()) {
      question = parsed.question.trim();
    } else if (typeof parsed.prompt === "string" && parsed.prompt.trim()) {
      question = parsed.prompt.trim();
    }
    if (typeof parsed.docPath === "string" && parsed.docPath.trim()) {
      docPath = parsed.docPath.trim();
    }
    const url = typeof parsed.url === "string" ? parsed.url.toLowerCase() : "";
    const combined = `${url} ${question}`.toLowerCase();
    marketIntent =
      url.includes("coingecko") ||
      url.includes("dexscreener") ||
      /price|market|dex|pair|token|cap|volume|liquidity/.test(combined);
    if (url.includes("docs.somnia")) {
      docPath = "readme";
    }
  } catch {
    if (step.payload.trim()) {
      question = step.payload.trim();
    }
  }

  return { question, docPath, marketIntent };
}

async function redirectDisabledWebIntel(
  deps: PlanRouterDeps,
  step: StepSpec,
): Promise<StepSpec> {
  const candidates = await deps.agentCatalog.loadCandidates();
  const { question, docPath, marketIntent } = parseWebIntelRedirectIntent(step);

  const dreamdex = candidates.find(
    (c) =>
      c.healthy &&
      c.isActive &&
      !c.suspended &&
      (c.name === "dreamdex-mcp" || c.name === "dreamdex-mcp@twiin"),
  );
  if (marketIntent && dreamdex) {
    return {
      ...step,
      configId: dreamdex.configId,
      payload: JSON.stringify({ action: "coingecko", id: "somnia" }),
    };
  }

  const docsLens = candidates.find(
    (c) =>
      c.healthy &&
      c.isActive &&
      !c.suspended &&
      (c.name === "docs-lens" || c.name === "docs-lens@twiin"),
  );
  if (docsLens) {
    return {
      ...step,
      configId: docsLens.configId,
      payload: JSON.stringify({ question, docPath }),
    };
  }

  if (dreamdex) {
    return {
      ...step,
      configId: dreamdex.configId,
      payload: JSON.stringify({ action: "coingecko", id: "somnia" }),
    };
  }

  throw new PlanError(
    PlanErrorCode.NO_CAPABLE_AGENT,
    "web-intel (configId 1) is disabled for planning — use docs-lens or dreamdex-mcp via a console prompt",
    422,
  );
}

async function normalizePlanSteps(
  deps: PlanRouterDeps,
  steps: StepSpec[],
  opts: {
    totalBudget: bigint;
    substitutions: Array<{ from: number; to: number }>;
  },
): Promise<
  {
    subAgentConfigId: bigint;
    payload: `0x${string}`;
    maxCostWei: bigint;
    timeoutSeconds: number;
  }[]
> {
  if (steps.length === 0 || steps.length > MAX_CONSOLE_TEMPLATE_STEPS) {
    throw new PlanError(
      PlanErrorCode.INVALID_REQUEST,
      `plan has ${steps.length} steps; planner limit is ${MAX_CONSOLE_TEMPLATE_STEPS}`,
      422,
    );
  }

  const nextConfigId = await deps.readNextConfigId();
  const requestDeposit = await deps.readRequestDeposit();
  let spent = 0n;
  const used = new Set<number>();

  const normalized = [];
  for (let i = 0; i < steps.length; i++) {
    let step = steps[i]!;
    if (step.configId === NativeConfigId.WEB_INTEL) {
      const from = step.configId;
      step = await redirectDisabledWebIntel(deps, step);
      steps[i] = step;
      opts.substitutions.push({ from, to: step.configId });
      logTaskTimeline("plan_substitution", {
        from,
        to: step.configId,
        reason: "web_intel_disabled",
      });
    }

    let configIdNum = step.configId;
    let remainingBudget = opts.totalBudget - spent;

    const resolveStep = async (configId: number, allowExternalRefresh = true) => {
      const configIdBig = BigInt(configId);
      if (configIdBig >= nextConfigId) {
        throw new PlanError(
          PlanErrorCode.NO_CAPABLE_AGENT,
          `planner selected unknown configId ${configId}`,
          422,
        );
      }
      if (configId === NativeConfigId.JANICE || configId === NativeConfigId.EXECUTOR) {
        throw new PlanError(
          PlanErrorCode.NO_CAPABLE_AGENT,
          `planner selected reserved configId ${configId}`,
          422,
        );
      }

      const agent = await deps.readAgent(configIdBig);
      let catalogAgent = (await deps.agentCatalog.loadCandidates()).find(
        (c) => c.configId === configId,
      );
      const isNative = agent.lane === AgentLane.SomniaNative;
      let healthy = isNative
        ? agent.isActive && !agent.suspended
        : (catalogAgent?.healthy ?? false);

      if (
        allowExternalRefresh &&
        !isNative &&
        agent.name &&
        !healthy
      ) {
        const refreshed = await verifyExternalAgentCacheEntry(configId.toString());
        if (refreshed) {
          deps.agentCatalog.invalidate();
          catalogAgent = (await deps.agentCatalog.loadCandidates(true)).find(
            (c) => c.configId === configId,
          );
          healthy = catalogAgent?.healthy ?? false;
        }
      }

      if (!agent.name || !healthy) {
        const alt = await deps.agentCatalog.substitute(
          configId,
          remainingBudget,
          used,
        );
        if (!alt) {
          const label = agent.name || `configId ${configId}`;
          throw new PlanError(
            PlanErrorCode.NO_CAPABLE_AGENT,
            `no healthy agent available for ${label} (configId ${configId}). Run external agents (pnpm dev:agents) and ensure the planner backend can reach their /health endpoint.`,
            422,
            {
              missingCapabilities: catalogAgent?.capabilityNames ?? [],
              agentName: agent.name || undefined,
              unhealthyConfigId: configId,
            },
          );
        }
        opts.substitutions.push({ from: configId, to: alt.configId });
        logTaskTimeline("plan_substitution", {
          from: configId,
          to: alt.configId,
        });
        return resolveStep(alt.configId, false);
      }

      const exactCostWei = isNative
        ? requestDeposit + agent.costWei * 3n
        : agent.costWei;

      if (spent + exactCostWei > opts.totalBudget) {
        throw new PlanError(
          PlanErrorCode.BUDGET_EXCEEDED,
          "planned step costs exceed task budget",
          422,
          {
            estimatedCostWei: (spent + exactCostWei).toString(),
            budgetWei: opts.totalBudget.toString(),
          },
        );
      }

      used.add(configId);
      spent += exactCostWei;
      const payloadText = hardenPlannerPayload(configId, step.payload, agent.name);
      if (!isNative) validateExternalAgentPayload(agent.name, payloadText);
      const payload = encodeStepPayload(configId, payloadText, isNative);
      return {
        subAgentConfigId: BigInt(configId),
        payload,
        maxCostWei: exactCostWei,
        timeoutSeconds: step.timeoutSeconds,
      };
    };

    normalized.push(await resolveStep(configIdNum));
  }

  return normalized;
}

const DOCS_LENS_BAD_DOC_PATHS = new Set(["defi", "agents"]);

function hardenDocsLensPayload(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    if (typeof parsed.docPath === "string") {
      const normalized = parsed.docPath
        .trim()
        .replace(/^\/+|\/+$/g, "")
        .replace(/\.md$/i, "")
        .toLowerCase();
      if (DOCS_LENS_BAD_DOC_PATHS.has(normalized)) {
        parsed.docPath = "readme";
      }
    } else {
      parsed.docPath = "readme";
    }
    return JSON.stringify(parsed);
  } catch {
    return payload;
  }
}

function hardenPlannerPayload(
  configId: number,
  payload: string,
  agentName?: string | null,
): string {
  if (agentName === "docs-lens" || agentName === "docs-lens@twiin") {
    payload = hardenDocsLensPayload(payload);
  }
  if (
    configId !== NativeConfigId.ANALYSIS &&
    configId !== NativeConfigId.REPORTER
  ) {
    return payload;
  }
  const guardrail = [
    "",
    "Hard rules:",
    "- Use only facts present in previous step outputs.",
    "- Do not invent or assume the current date. If no date is provided upstream, omit it.",
    '- If a required value is missing, write "unavailable" instead of guessing.',
    "- Do not fabricate prices, percentages, market cap, volume, sentiment drivers, or outlook catalysts.",
  ].join("\n");
  return `${payload.trim()}\n\n${guardrail}`;
}

async function createPlannerMessage(
  deps: PlanRouterDeps,
  systemPrompt: string,
  goal: string,
): Promise<PlannerMessage> {
  const model = "claude-haiku-4-5-20251001";
  const maxAttempts = 3;
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      deps.plannerBudgetGuard.ensureRequestAllowed();
    } catch (error) {
      throw new PlanError(
        PlanErrorCode.PLANNER_UNAVAILABLE,
        error instanceof Error ? error.message : "planner budget guard blocked request",
        503,
      );
    }
    try {
      const msg = await deps.anthropic.messages.create({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        tools: [SUBMIT_PLAN_TOOL],
        tool_choice: { type: "tool", name: "submit_plan" },
        messages: [{ role: "user", content: goal }],
      });
      deps.plannerBudgetGuard.recordUsage(
        (msg as { usage?: unknown }).usage,
        model,
      );
      return msg as PlannerMessage;
    } catch (error) {
      lastError = error;
      deps.plannerBudgetGuard.noteFailure(error);
      if (attempt >= maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }

  throw new PlanError(
    PlanErrorCode.PLANNER_UNAVAILABLE,
    lastError instanceof Error ? lastError.message : "planner unavailable",
    503,
  );
}

function extractPlannerText(message: PlannerMessage): string {
  return message.content
    .filter(
      (block): block is { type: "text"; text?: string } => block.type === "text",
    )
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
}
