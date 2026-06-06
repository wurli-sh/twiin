import {
  encodeTrustlessJanicePayload,
  JANICE_ROUND_BUFFER_MULTIPLIER,
  MAX_JANICE_ITERATIONS,
  MIN_TRUSTLESS_BUDGET_MULTIPLIER,
  type TrustlessJaniceResult,
} from "@twiin/shared";

export const TRUSTLESS_SYSTEM_PROMPT =
  "You are Janice, a trustless planner. Use on-chain tools or complete the task.";

export type TrustlessTurnRecord = {
  iteration: number;
  finishReason: string;
  assistantMessage: string;
  toolCalls: Array<{ toolName: string; args: `0x${string}` }>;
};

export type TrustlessStepRecord = {
  stepIdx: number;
  state: number;
  payload: string;
  resultHex: string | null;
  score: number | null;
};

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

export function buildTrustlessResumePayload(input: {
  goal: string;
  turns: TrustlessTurnRecord[];
  steps: TrustlessStepRecord[];
  maxIterations?: number;
}): `0x${string}` {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "user", content: input.goal },
  ];

  for (const turn of input.turns.sort((a, b) => a.iteration - b.iteration)) {
    messages.push({
      role: "assistant",
      content: normalizeAssistantSummary(turn),
    });

    const outcomeSummary = summarizeToolOutcomes(turn, input.steps);
    if (outcomeSummary) {
      messages.push({
        role: "user",
        content: outcomeSummary,
      });
    }
  }

  messages.push({
    role: "user",
    content:
      "Continue from the latest tool outcomes. Either call the next required tool or complete the task.",
  });

  return encodeTrustlessJanicePayload({
    systemPrompt: TRUSTLESS_SYSTEM_PROMPT,
    messagesJson: JSON.stringify(messages),
    maxIterations: input.maxIterations ?? MAX_JANICE_ITERATIONS,
  });
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
  };
}

function normalizeAssistantSummary(turn: TrustlessTurnRecord): string {
  const base = turn.assistantMessage.trim();
  const toolList = turn.toolCalls.map((tool) => tool.toolName).join(", ");
  if (base && toolList) {
    return `${base}\nTools: ${toolList}`;
  }
  if (base) return base;
  if (toolList) return `Requested tools: ${toolList}`;
  return `Finish reason: ${turn.finishReason}`;
}

function summarizeToolOutcomes(
  turn: TrustlessTurnRecord,
  steps: TrustlessStepRecord[],
): string | null {
  if (turn.toolCalls.length === 0) return null;
  const latestStep = [...steps].sort((a, b) => b.stepIdx - a.stepIdx)[0];
  const lines = turn.toolCalls.map((tool) => {
    if (tool.toolName === "hireSubAgent" && latestStep) {
      return `Tool ${tool.toolName} produced step ${latestStep.stepIdx} with state ${latestStep.state}${latestStep.resultHex ? ` and result ${decodeHexText(latestStep.resultHex)}` : ""}.`;
    }
    if (tool.toolName === "publishOracle") {
      return "Tool publishOracle succeeded on-chain.";
    }
    if (tool.toolName === "rateSubAgent") {
      return "Tool rateSubAgent succeeded on-chain.";
    }
    return `Tool ${tool.toolName} executed.`;
  });
  return lines.join("\n");
}

function decodeHexText(value: string): string {
  try {
    return Buffer.from(value.slice(2), "hex").toString("utf8");
  } catch {
    return value;
  }
}
