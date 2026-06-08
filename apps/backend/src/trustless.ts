import {
  AgentLane,
  buildInitialJaniceConversation,
  buildTrustlessResumePayload,
  encodeNativeAgentPayload,
  encodeTrustlessJanicePayload,
  JANICE_ROUND_BUFFER_MULTIPLIER,
  MIN_TRUSTLESS_BUDGET_MULTIPLIER,
  NativeConfigId,
  TRUSTLESS_SYSTEM_PROMPT,
  type TrustlessJaniceResult,
  type TrustlessStepInput,
  type TrustlessTurnInput,
} from "@twiin/shared";

export {
  TRUSTLESS_SYSTEM_PROMPT,
  buildTrustlessResumePayload,
  type TrustlessStepInput,
  type TrustlessTurnInput,
};

export type TrustlessTurnRecord = TrustlessTurnInput;
export type TrustlessStepRecord = TrustlessStepInput;

const NATIVE_AGENT_LABELS: Record<number, string> = {
  [NativeConfigId.WEB_INTEL]: "web-intel@twiin",
  [NativeConfigId.ORACLE]: "somnia-oracle@twiin",
  [NativeConfigId.ANALYSIS]: "analysis-bot@twiin",
  [NativeConfigId.REPORTER]: "reporter-bot@twiin",
};

const TRUSTLESS_AGENT_CONTEXT = `
Available sub-agents (use configId in hireSubAgent):
- Do NOT use configId ${NativeConfigId.WEB_INTEL} (web-intel@twiin) — disabled. For docs use docs-lens (external). For market data use dreamdex-mcp (external).
- configId ${NativeConfigId.ORACLE} (somnia-oracle@twiin): Fetches a JSON API. payload=JSON {"url":"https://...","selector":"leaf.path"} — prefer dreamdex-mcp coingecko over native oracle on testnet.
- configId ${NativeConfigId.ANALYSIS} (analysis-bot@twiin): Analyzes prior results. payload=plain text instruction.
- configId ${NativeConfigId.REPORTER} (reporter-bot@twiin): Writes a final report. payload=plain text instruction.

Rules:
- Do NOT use configId ${NativeConfigId.JANICE}, configId ${NativeConfigId.EXECUTOR}, or configId ${NativeConfigId.WEB_INTEL}.
- Call exactly one hireSubAgent per Janice round when hiring; do not batch hireSubAgent with other tools.
- Use completeTrustlessTask when the goal is satisfied.
- Never invent URLs, prices, or facts not present in prior step outputs.
`.trim();

const SOMNIA_STATS_API_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=somnia&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true";

const SOMNIA_PRICE_PAYLOAD = encodeNativeAgentPayload(
  NativeConfigId.ORACLE,
  JSON.stringify({
    url: SOMNIA_STATS_API_URL,
    selector: "somnia.usd",
  }),
);

const SOMNIA_CHANGE_PAYLOAD = encodeNativeAgentPayload(
  NativeConfigId.ORACLE,
  JSON.stringify({
    url: SOMNIA_STATS_API_URL,
    selector: "somnia.usd_24h_change",
  }),
);

const SOMNIA_MARKET_CAP_PAYLOAD = encodeNativeAgentPayload(
  NativeConfigId.ORACLE,
  JSON.stringify({
    url: SOMNIA_STATS_API_URL,
    selector: "somnia.usd_market_cap",
  }),
);

const SOMNIA_VOLUME_PAYLOAD = encodeNativeAgentPayload(
  NativeConfigId.ORACLE,
  JSON.stringify({
    url: SOMNIA_STATS_API_URL,
    selector: "somnia.usd_24h_vol",
  }),
);

const SOMNIA_STATS_TRUSTLESS_GOAL = [
  "Fetch Somnia ecosystem stats using the native oracle only.",
  `Round 1: call hireSubAgent with configId ${NativeConfigId.ORACLE}.`,
  `Use this exact ABI bytes payload in round 1: ${SOMNIA_PRICE_PAYLOAD}.`,
  `After round 1 succeeds, if 24h change has not been fetched yet, call hireSubAgent with configId ${NativeConfigId.ORACLE} and this exact ABI bytes payload: ${SOMNIA_CHANGE_PAYLOAD}.`,
  `After that succeeds, if market cap has not been fetched yet, call hireSubAgent with configId ${NativeConfigId.ORACLE} and this exact ABI bytes payload: ${SOMNIA_MARKET_CAP_PAYLOAD}.`,
  `After that succeeds, if 24h volume has not been fetched yet, call hireSubAgent with configId ${NativeConfigId.ORACLE} and this exact ABI bytes payload: ${SOMNIA_VOLUME_PAYLOAD}.`,
  "Once all four values exist in prior step results, call completeTrustlessTask with a concise summary covering: price USD, 24h change, market cap USD, and 24h volume USD.",
  "For native oracle hires, pass the ABI bytes payload exactly as provided above. Do not convert it to JSON or plain text.",
  "Do not hire any other agent. Do not ask follow-up questions. Do not emit any text before the tool call.",
].join("\n");

const SOMNIA_SENTIMENT_TRUSTLESS_GOAL = [
  "Produce a Somnia sentiment snapshot using the native oracle only.",
  `Round 1: call hireSubAgent with configId ${NativeConfigId.ORACLE}.`,
  `Use this exact ABI bytes payload in round 1: ${SOMNIA_PRICE_PAYLOAD}.`,
  `After round 1 succeeds, if 24h change has not been fetched yet, call hireSubAgent with configId ${NativeConfigId.ORACLE} and this exact ABI bytes payload: ${SOMNIA_CHANGE_PAYLOAD}.`,
  `After that succeeds, if market cap has not been fetched yet, call hireSubAgent with configId ${NativeConfigId.ORACLE} and this exact ABI bytes payload: ${SOMNIA_MARKET_CAP_PAYLOAD}.`,
  `After that succeeds, if 24h volume has not been fetched yet, call hireSubAgent with configId ${NativeConfigId.ORACLE} and this exact ABI bytes payload: ${SOMNIA_VOLUME_PAYLOAD}.`,
  "Once all fetched values exist in prior step results, call completeTrustlessTask with a concise sentiment summary grounded only in those values.",
  "For native oracle hires, pass the ABI bytes payload exactly as provided above. Do not convert it to JSON or plain text.",
  "Do not hire any other agent. Do not ask follow-up questions. Do not emit any text before the tool call.",
].join("\n");

export function exactNativeStepCostWei(
  requestDepositWei: bigint,
  runnerCostWei: bigint,
): bigint {
  return requestDepositWei + runnerCostWei * BigInt(JANICE_ROUND_BUFFER_MULTIPLIER);
}

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

export function estimateTrustlessBudget(input: {
  goal: string;
  janiceCostWei: bigint;
  nativeAgentCostsByConfigId: Map<number, bigint>;
}): {
  minBudgetWei: bigint;
  recommendedBudgetWei: bigint;
  reason: string;
} {
  const baseMin = minimumTrustlessBudgetWei(input.janiceCostWei);

  if (isSomniaSentimentGoal(input.goal) || isSomniaStatsGoal(input.goal)) {
    const oracleFlowMin = input.janiceCostWei * 7n;
    return {
      minBudgetWei: oracleFlowMin,
      recommendedBudgetWei: oracleFlowMin,
      reason:
        "Somnia stats/sentiment goals typically need several Janice rounds plus an oracle hire step.",
    };
  }

  const stepCosts = [...input.nativeAgentCostsByConfigId.values()].filter((v) => v > 0n);
  const cheapestStep = stepCosts.reduce<bigint>(
    (min, value) => (min === 0n || value < min ? value : min),
    0n,
  );
  const recommended = cheapestStep > 0n ? baseMin + cheapestStep : baseMin;

  return {
    minBudgetWei: baseMin,
    recommendedBudgetWei: recommended,
    reason: "Minimum covers two Janice inference rounds before any sub-agent hires.",
  };
}

type ExternalAgentRow = {
  config_id: string;
  endpoint_url: string;
  capabilities: string[];
};

export async function buildTrustlessAgentContext(
  externalAgents: ExternalAgentRow[],
  capabilityNameById: Map<string, string>,
  readAgent: (configId: bigint) => Promise<{
    name: string;
    costWei: bigint;
    isActive: boolean;
    suspended: boolean;
    lane?: number;
  }>,
): Promise<string> {
  const lines: string[] = [TRUSTLESS_AGENT_CONTEXT, "", "Native sub-agents:"];

  for (let id = NativeConfigId.WEB_INTEL; id <= NativeConfigId.REPORTER; id++) {
    try {
      const agent = await readAgent(BigInt(id));
      if (!agent.isActive || agent.suspended || !agent.name) continue;
      lines.push(`- configId ${id} (${NATIVE_AGENT_LABELS[id] ?? agent.name})`);
    } catch {
      /* skip */
    }
  }

  if (externalAgents.length > 0) {
    lines.push("", "Verified external agents:");
    for (const ext of externalAgents) {
      try {
        const agent = await readAgent(BigInt(ext.config_id));
        if (!agent.isActive || agent.suspended) continue;
        const capNames = ext.capabilities
          .map((cap) => capabilityNameById.get(cap) ?? cap.slice(0, 10))
          .join(", ");
        lines.push(
          `- configId ${ext.config_id} (${agent.name}, ${agent.lane === AgentLane.SomniaNative ? "native" : "external"}${capNames ? `, caps: ${capNames}` : ""})`,
        );
      } catch {
        /* skip */
      }
    }
  }

  return lines.join("\n");
}

export function buildTrustlessGoalWithContext(goal: string, contextMessage?: string): string {
  const trimmedGoal = goal.trim();
  const trimmedContext = contextMessage?.trim();
  if (!trimmedContext) return trimmedGoal;
  return `${trimmedGoal}\n\n${trimmedContext}`;
}

export function buildTrustlessIntentGoal(goal: string, contextMessage?: string): string {
  if (isSomniaStatsGoal(goal)) return SOMNIA_STATS_TRUSTLESS_GOAL;
  if (isSomniaSentimentGoal(goal)) return SOMNIA_SENTIMENT_TRUSTLESS_GOAL;
  return buildTrustlessGoalWithContext(goal, contextMessage);
}

export function computeJaniceCostWei(
  requestDepositWei: bigint,
  janiceRunnerCostWei: bigint,
): bigint {
  return requestDepositWei + janiceRunnerCostWei * BigInt(JANICE_ROUND_BUFFER_MULTIPLIER);
}

export function minimumTrustlessBudgetWei(
  janiceCostWei: bigint,
): bigint {
  return janiceCostWei * BigInt(MIN_TRUSTLESS_BUDGET_MULTIPLIER);
}

export function normalizeTurnFromJaniceResult(
  iteration: number,
  result: TrustlessJaniceResult,
): TrustlessTurnRecord {
  return {
    iteration,
    finishReason: result.finishReason,
    assistantMessage: result.assistantMessage,
    toolCalls: result.toolCalls.map((tool) => ({
      toolName: tool.toolName,
      args: tool.args,
    })),
    updatedRoles: result.updatedRoles,
    updatedMessages: result.updatedMessages,
    pendingToolCallIds: result.pendingToolCallIds,
  };
}

export function buildInitialTrustlessJanicePayload(goal: string): `0x${string}` {
  const { roles, messages } = buildInitialJaniceConversation(goal);
  return encodeTrustlessJanicePayload({ roles, messages });
}
