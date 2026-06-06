import {
  AgentLane,
  buildInitialJaniceConversation,
  buildTrustlessResumePayload,
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
- configId ${NativeConfigId.WEB_INTEL} (web-intel@twiin): Scrapes a web page. payload=JSON {"url":"https://...","prompt":"what to extract"}.
- configId ${NativeConfigId.ORACLE} (somnia-oracle@twiin): Fetches a JSON API. payload=JSON {"url":"https://...","selector":"leaf.path","decimals":8}.
- configId ${NativeConfigId.ANALYSIS} (analysis-bot@twiin): Analyzes prior results. payload=plain text instruction.
- configId ${NativeConfigId.REPORTER} (reporter-bot@twiin): Writes a final report. payload=plain text instruction.

Rules:
- Do NOT use configId ${NativeConfigId.JANICE} or configId ${NativeConfigId.EXECUTOR}.
- Call exactly one hireSubAgent per Janice round when hiring; do not batch hireSubAgent with other tools.
- Use completeTrustlessTask when the goal is satisfied.
- Never invent URLs, prices, or facts not present in prior step outputs.
`.trim();

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
  caps: string[];
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
        const capNames = ext.caps
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
