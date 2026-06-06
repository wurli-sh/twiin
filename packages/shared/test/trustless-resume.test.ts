import { describe, expect, it } from "vitest";
import { INFER_TOOLS_CHAT_MAX_ITERATIONS } from "../constants";
import {
  buildTrustlessResumePayload,
  decodeTrustlessJanicePayload,
} from "../trustless";

describe("buildTrustlessResumePayload", () => {
  it("appends tool role messages with pendingToolCallIds per Somnia docs", () => {
    const payload = buildTrustlessResumePayload({
      goal: "Research Somnia market data",
      turns: [
        {
          iteration: 1,
          finishReason: "tool_calls",
          assistantMessage: "Hiring oracle agent",
          toolCalls: [{ toolName: "hireSubAgent", args: "0x1234" }],
          updatedRoles: ["system", "user", "assistant"],
          updatedMessages: [
            "You are Janice...",
            "Research Somnia market data",
            "I will hire the oracle agent.",
          ],
          pendingToolCallIds: ["call_abc123"],
        },
      ],
      steps: [
        {
          stepIdx: 0,
          state: 4,
          payload: '{"url":"https://api.example.com","selector":"price"}',
          resultHex: "0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000046f6b000000000000000000000000000000000000000000000000000000",
          score: null,
        },
      ],
    });

    const decoded = decodeTrustlessJanicePayload(payload);
    expect(decoded.maxIterations).toBe(BigInt(INFER_TOOLS_CHAT_MAX_ITERATIONS));
    expect(decoded.roles).toContain("tool");
    expect(decoded.roles.filter((role) => role === "user").length).toBe(1);

    const toolIdx = decoded.roles.lastIndexOf("tool");
    expect(toolIdx).toBeGreaterThanOrEqual(0);
    const toolMessage = JSON.parse(decoded.messages[toolIdx]) as {
      tool_call_id: string;
      content: string;
    };
    expect(toolMessage.tool_call_id).toBe("call_abc123");
    expect(toolMessage.content).toContain("Step 0 completed");
    expect(toolMessage.content).toContain("ok");
  });

  it("reconstructs fallback conversation with tool roles when updated state is missing", () => {
    const payload = buildTrustlessResumePayload({
      goal: "Summarize news",
      turns: [
        {
          iteration: 1,
          finishReason: "tool_calls",
          assistantMessage: "Hiring web intel",
          toolCalls: [{ toolName: "hireSubAgent", args: "0xabcd" }],
          pendingToolCallIds: ["call_fallback"],
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
    expect(toolMessage.tool_call_id).toBe("call_fallback");
  });
});
