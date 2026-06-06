import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  sliceHex,
  toFunctionSelector,
  type Hex,
} from "viem";
import { AgentOrchestratorAbi } from "./abis";
import { INFER_TOOLS_CHAT_MAX_ITERATIONS } from "./constants";
import { decodeNativeAgentResult } from "./somnia-agents";

/** Matches Somnia LLM Inference agent — docs.somnia.network/agents/base-agents/llm-inference */
export const JaniceInferenceAbi = [
  {
    type: "function",
    name: "inferToolsChat",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roles", type: "string[]" },
      { name: "messages", type: "string[]" },
      { name: "mcpServerUrls", type: "string[]" },
      {
        name: "onchainTools",
        type: "tuple[]",
        components: [
          { name: "signature", type: "string" },
          { name: "description", type: "string" },
        ],
      },
      { name: "maxIterations", type: "uint256" },
      { name: "chainOfThought", type: "bool" },
    ],
    outputs: [
      { name: "finishReason", type: "string" },
      { name: "response", type: "string" },
      { name: "updatedRoles", type: "string[]" },
      { name: "updatedMessages", type: "string[]" },
      { name: "pendingToolCallIds", type: "string[]" },
      { name: "pendingToolCalls", type: "bytes[]" },
    ],
  },
] as const;

export const TRUSTLESS_SYSTEM_PROMPT =
  "You are Janice, a trustless planner on Twiin. Use the provided on-chain tools to hire sub-agents, publish oracle data, rate agents, or complete the task with a final result.";

/** Solidity signature strings — must match AgentOrchestrator trustless tool decoders. */
export const TRUSTLESS_ONCHAIN_TOOLS = [
  {
    signature: "hireSubAgent(uint256,bytes,uint256,uint32)",
    description:
      "Hire a registered sub-agent. Args: configId, ABI-encoded step payload, maxCostWei, timeoutSeconds.",
  },
  {
    signature: "completeTrustlessTask(string)",
    description: "Finish the trustless task with a concise final user-facing result.",
  },
  {
    signature:
      "publishOracle(uint256,string,string,uint8,uint256,uint256,bytes32)",
    description:
      "Publish oracle feed data. Args: personalAgentId, topic, value, confidence, maxAgeSeconds, refreshInterval, templateHash.",
  },
  {
    signature: "rateSubAgent(uint256,uint32,uint8)",
    description: "Rate a sub-agent. Args: configId, latencyMs, score (0-100).",
  },
] as const;

const TOOL_SELECTOR_TO_NAME: Record<Hex, string> = {
  [toFunctionSelector("hireSubAgent(uint256,bytes,uint256,uint32)")]: "hireSubAgent",
  [toFunctionSelector("completeTrustlessTask(string)")]: "completeTrustlessTask",
  [toFunctionSelector(
    "publishOracle(uint256,string,string,uint8,uint256,uint256,bytes32)",
  )]: "publishOracle",
  [toFunctionSelector("rateSubAgent(uint256,uint32,uint8)")]: "rateSubAgent",
};

export type TrustlessJaniceResult = {
  finishReason: "tool_calls" | "stop" | "max_iterations" | "error";
  toolCalls: Array<{ toolName: string; args: Hex }>;
  assistantMessage: string;
  updatedRoles: string[];
  updatedMessages: string[];
  pendingToolCallIds: string[];
};

export type TrustlessTurnInput = {
  iteration: number;
  finishReason: string;
  assistantMessage: string;
  toolCalls: Array<{ toolName: string; args: Hex }>;
  updatedRoles?: string[];
  updatedMessages?: string[];
  pendingToolCallIds?: string[];
};

export type TrustlessStepInput = {
  stepIdx: number;
  state: number;
  payload: string;
  resultHex: string | null;
  score: number | null;
};

export function buildInitialJaniceConversation(goal: string): {
  roles: string[];
  messages: string[];
} {
  return {
    roles: ["system", "user"],
    messages: [TRUSTLESS_SYSTEM_PROMPT, goal],
  };
}

export function encodeTrustlessJanicePayload(input: {
  roles: string[];
  messages: string[];
  maxIterations?: number;
  mcpServerUrls?: string[];
  chainOfThought?: boolean;
}): Hex {
  if (input.roles.length !== input.messages.length) {
    throw new Error("inferToolsChat roles/messages length mismatch");
  }

  return encodeFunctionData({
    abi: JaniceInferenceAbi,
    functionName: "inferToolsChat",
    args: [
      input.roles,
      input.messages,
      input.mcpServerUrls ?? [],
      TRUSTLESS_ONCHAIN_TOOLS.map((tool) => ({
        signature: tool.signature,
        description: tool.description,
      })),
      BigInt(input.maxIterations ?? INFER_TOOLS_CHAT_MAX_ITERATIONS),
      input.chainOfThought ?? false,
    ],
  });
}

/** Somnia docs: {"tool_call_id":"...","content":"result string"} */
export function formatToolResultMessage(
  toolCallId: string,
  content: string,
): string {
  return JSON.stringify({ tool_call_id: toolCallId, content });
}

export function formatToolResultContent(
  tool: { toolName: string },
  step?: TrustlessStepInput,
): string {
  if (tool.toolName === "hireSubAgent") {
    if (!step) {
      return "Tool hireSubAgent was requested but no matching step outcome is indexed yet.";
    }
    const decoded =
      step.resultHex != null
        ? decodeNativeAgentResult(step.resultHex)
        : null;
    const resultText = decoded ?? (step.resultHex ? step.resultHex : "no result");
    return `Step ${step.stepIdx} completed with state ${step.state}. Result: ${resultText}`;
  }
  if (tool.toolName === "publishOracle") {
    return "Tool publishOracle executed successfully.";
  }
  if (tool.toolName === "rateSubAgent") {
    return "Tool rateSubAgent executed successfully.";
  }
  if (tool.toolName === "completeTrustlessTask") {
    return "Tool completeTrustlessTask executed successfully.";
  }
  return `Tool ${tool.toolName} executed.`;
}

export function appendToolResultsToConversation(
  roles: string[],
  messages: string[],
  turn: TrustlessTurnInput,
  steps: TrustlessStepInput[],
  priorHireCount = 0,
): { roles: string[]; messages: string[] } {
  const nextRoles = [...roles];
  const nextMessages = [...messages];
  const sortedSteps = [...steps].sort((a, b) => a.stepIdx - b.stepIdx);
  let hireIdxInTurn = 0;

  for (let i = 0; i < turn.toolCalls.length; i++) {
    const tool = turn.toolCalls[i];
    const toolCallId = turn.pendingToolCallIds?.[i] ?? `call_${i}`;
    let matchedStep: TrustlessStepInput | undefined;
    if (tool.toolName === "hireSubAgent") {
      matchedStep = sortedSteps[priorHireCount + hireIdxInTurn];
      hireIdxInTurn += 1;
    }
    nextRoles.push("tool");
    nextMessages.push(
      formatToolResultMessage(toolCallId, formatToolResultContent(tool, matchedStep)),
    );
  }

  return { roles: nextRoles, messages: nextMessages };
}

function countPriorHires(turns: TrustlessTurnInput[], iteration: number): number {
  return turns
    .filter((turn) => turn.iteration < iteration)
    .reduce(
      (count, turn) =>
        count + turn.toolCalls.filter((tool) => tool.toolName === "hireSubAgent").length,
      0,
    );
}

function normalizeAssistantSummary(turn: TrustlessTurnInput): string {
  const base = turn.assistantMessage.trim();
  const toolList = turn.toolCalls.map((tool) => tool.toolName).join(", ");
  if (base && toolList) {
    return `${base}\nTools: ${toolList}`;
  }
  if (base) return base;
  if (toolList) return `Requested tools: ${toolList}`;
  return `Finish reason: ${turn.finishReason}`;
}

export function buildTrustlessResumePayload(input: {
  goal: string;
  turns: TrustlessTurnInput[];
  steps: TrustlessStepInput[];
}): Hex {
  const latestTurn = [...input.turns].sort((a, b) => b.iteration - a.iteration)[0];
  if (
    latestTurn?.updatedRoles?.length &&
    latestTurn.updatedMessages?.length &&
    latestTurn.updatedRoles.length === latestTurn.updatedMessages.length
  ) {
    const { roles, messages } = appendToolResultsToConversation(
      [...latestTurn.updatedRoles],
      [...latestTurn.updatedMessages],
      latestTurn,
      input.steps,
      countPriorHires(input.turns, latestTurn.iteration),
    );
    return encodeTrustlessJanicePayload({ roles, messages });
  }

  const roles: string[] = ["system", "user"];
  const messages: string[] = [TRUSTLESS_SYSTEM_PROMPT, input.goal];

  for (const turn of [...input.turns].sort((a, b) => a.iteration - b.iteration)) {
    roles.push("assistant");
    messages.push(normalizeAssistantSummary(turn));
    if (turn.toolCalls.length > 0) {
      const withTools = appendToolResultsToConversation(
        roles,
        messages,
        turn,
        input.steps,
        countPriorHires(input.turns, turn.iteration),
      );
      roles.length = 0;
      roles.push(...withTools.roles);
      messages.length = 0;
      messages.push(...withTools.messages);
    }
  }

  return encodeTrustlessJanicePayload({ roles, messages });
}

export function encodeCreateTrustlessTask(input: {
  personalAgentId: bigint;
  goal: string;
  contextMessage?: string;
  budgetWei: bigint;
}): Hex {
  const intentGoal = input.contextMessage?.trim()
    ? `${input.goal.trim()}\n\n${input.contextMessage.trim()}`
    : input.goal.trim();
  return encodeFunctionData({
    abi: AgentOrchestratorAbi,
    functionName: "createTrustlessTask",
    args: [
      input.personalAgentId,
      encodeAbiParameters([{ type: "string" }], [intentGoal]),
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
  const [
    finishReasonRaw,
    response,
    updatedRoles,
    updatedMessages,
    pendingToolCallIds,
    pendingToolCalls,
  ] = decodeAbiParameters(
    [
      { type: "string" },
      { type: "string" },
      { type: "string[]" },
      { type: "string[]" },
      { type: "string[]" },
      { type: "bytes[]" },
    ],
    data,
  );

  const finishReason = normalizeFinishReason(finishReasonRaw);
  const toolCalls = pendingToolCalls.map((calldata) => {
    const selector = sliceHex(calldata, 0, 4);
    const toolName = TOOL_SELECTOR_TO_NAME[selector] ?? "unknown";
    const args = (calldata.length > 10 ? sliceHex(calldata, 4) : "0x") as Hex;
    return { toolName, args };
  });

  return {
    finishReason,
    toolCalls,
    assistantMessage: response,
    updatedRoles: [...updatedRoles],
    updatedMessages: [...updatedMessages],
    pendingToolCallIds: [...pendingToolCallIds],
  };
}

/** Decode a Janice request payload emitted by the orchestrator (for debugging/tests). */
export function decodeTrustlessJanicePayload(payload: Hex): {
  roles: string[];
  messages: string[];
  maxIterations: bigint;
} {
  const decoded = decodeFunctionData({
    abi: JaniceInferenceAbi,
    data: payload,
  });
  if (decoded.functionName !== "inferToolsChat") {
    throw new Error(`expected inferToolsChat, got ${decoded.functionName}`);
  }
  const [roles, messages, , , maxIterations] = decoded.args;
  return {
    roles: [...roles],
    messages: [...messages],
    maxIterations,
  };
}

function normalizeFinishReason(
  value: string,
): TrustlessJaniceResult["finishReason"] {
  if (value === "tool_calls" || value === "stop" || value === "max_iterations") {
    return value;
  }
  return "error";
}
