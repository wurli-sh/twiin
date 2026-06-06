import {
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
} from "viem";
import { AgentOrchestratorAbi } from "./abis";
import { MAX_JANICE_ITERATIONS } from "./constants";

export const JaniceInferenceAbi = [
  {
    type: "function",
    name: "inferToolsChat",
    stateMutability: "nonpayable",
    inputs: [
      { name: "systemPrompt", type: "string" },
      { name: "messagesJson", type: "string" },
      { name: "onchainToolsJson", type: "string" },
      { name: "maxIterations", type: "uint8" },
    ],
    outputs: [],
  },
] as const;

export type TrustlessJaniceResult = {
  finishReason: "tool_calls" | "stop" | "max_iterations" | "error";
  toolCalls: Array<{ toolName: string; args: Hex }>;
  assistantMessage: string;
};

export const TRUSTLESS_ONCHAIN_TOOLS = [
  { name: "hireSubAgent" },
  { name: "publishOracle" },
  { name: "rateSubAgent" },
  { name: "completeTrustlessTask" },
] as const;

export function encodeTrustlessJanicePayload(input: {
  systemPrompt: string;
  messagesJson: string;
  onchainToolsJson?: string;
  maxIterations?: number;
}): Hex {
  return encodeFunctionData({
    abi: JaniceInferenceAbi,
    functionName: "inferToolsChat",
    args: [
      input.systemPrompt,
      input.messagesJson,
      input.onchainToolsJson ?? JSON.stringify(TRUSTLESS_ONCHAIN_TOOLS),
      input.maxIterations ?? MAX_JANICE_ITERATIONS,
    ],
  });
}

export function encodeCreateTrustlessTask(input: {
  personalAgentId: bigint;
  goal: string;
  budgetWei: bigint;
}): Hex {
  return encodeFunctionData({
    abi: AgentOrchestratorAbi,
    functionName: "createTrustlessTask",
    args: [
      input.personalAgentId,
      encodeAbiParameters([{ type: "string" }], [input.goal]),
      input.budgetWei,
    ],
  });
}

export function encodeResumeTrustlessTask(input: {
  taskId: bigint;
  resumePayload: Hex;
  janiceCostWei: bigint;
}): Hex {
  return encodeFunctionData({
    abi: AgentOrchestratorAbi,
    functionName: "resumeTrustlessTask",
    args: [input.taskId, input.resumePayload, input.janiceCostWei],
  });
}

export function decodeTrustlessJaniceResult(data: Hex): TrustlessJaniceResult {
  const [finishReasonRaw, toolNames, toolArgs, assistantMessage] = decodeAbiParameters(
    [
      { type: "string" },
      { type: "string[]" },
      { type: "bytes[]" },
      { type: "string" },
    ],
    data,
  );

  const finishReason = normalizeFinishReason(finishReasonRaw);
  const toolCalls = toolNames.map((toolName, idx) => ({
    toolName,
    args: toolArgs[idx] as Hex,
  }));

  return { finishReason, toolCalls, assistantMessage };
}

function normalizeFinishReason(
  value: string,
): TrustlessJaniceResult["finishReason"] {
  if (value === "tool_calls" || value === "stop" || value === "max_iterations") {
    return value;
  }
  return "error";
}
