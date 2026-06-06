import { describe, expect, it } from "vitest";
import {
  buildTrustlessResumePayload,
  decodeTrustlessJanicePayload,
  INFER_TOOLS_CHAT_MAX_ITERATIONS,
  NativeConfigId,
} from "@twiin/shared";
import {
  computeJaniceCostWei,
  estimateTrustlessBudget,
  exactNativeStepCostWei,
  minimumTrustlessBudgetWei,
} from "../src/trustless";

describe("trustless helpers", () => {
  it("computes native step and janice costs", () => {
    expect(exactNativeStepCostWei(30n, 70n)).toBe(240n);
    expect(computeJaniceCostWei(30n, 70n)).toBe(240n);
    expect(minimumTrustlessBudgetWei(240n)).toBe(480n);
  });

  it("estimates generic trustless minimum budget", () => {
    const estimate = estimateTrustlessBudget({
      goal: "Summarize the latest news",
      janiceCostWei: 240n,
      nativeAgentCostsByConfigId: new Map([[NativeConfigId.ANALYSIS, 240n]]),
    });
    expect(estimate.minBudgetWei).toBe(480n);
    expect(estimate.recommendedBudgetWei).toBe(720n);
  });

  it("estimates Somnia stats oracle-flow minimum budget", () => {
    const estimate = estimateTrustlessBudget({
      goal: "Fetch Somnia ecosystem stats: price, 24h change, market cap, and 24h volume",
      janiceCostWei: 240n,
      nativeAgentCostsByConfigId: new Map([[NativeConfigId.ORACLE, 120n]]),
    });
    expect(estimate.minBudgetWei).toBe(1680n);
    expect(estimate.recommendedBudgetWei).toBe(1680n);
  });

  it("builds resume payload with tool roles from Janice updated conversation state", () => {
    const payload = buildTrustlessResumePayload({
      goal: "Research X",
      turns: [
        {
          iteration: 1,
          finishReason: "tool_calls",
          assistantMessage: "Hiring web intel",
          toolCalls: [{ toolName: "hireSubAgent", args: "0x1234" }],
          updatedRoles: ["system", "user", "assistant"],
          updatedMessages: ["system prompt", "Research X", "Hiring web intel"],
          pendingToolCallIds: ["call_resume_1"],
        },
      ],
      steps: [
        {
          stepIdx: 0,
          state: 4,
          payload: "scrape",
          resultHex: "0x6f6b",
          score: null,
        },
      ],
    });

    const decoded = decodeTrustlessJanicePayload(payload);
    expect(decoded.maxIterations).toBe(BigInt(INFER_TOOLS_CHAT_MAX_ITERATIONS));
    expect(decoded.roles).toContain("tool");
    const toolIdx = decoded.roles.lastIndexOf("tool");
    const toolMessage = JSON.parse(decoded.messages[toolIdx]) as {
      tool_call_id: string;
      content: string;
    };
    expect(toolMessage.tool_call_id).toBe("call_resume_1");
    expect(toolMessage.content).toContain("Step 0");
  });
});
