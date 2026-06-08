import { parsePayload, type ExternalExecuteInput } from "@twiin/external-kit";
import type { AgentAdapterEnv } from "./env";

export async function executeAgentAdapter(input: ExternalExecuteInput): Promise<string> {
  const env = input.env as AgentAdapterEnv;
  const parsed = parsePayload(input.payloadHex);
  const prompt = parsed.raw;

  if (env.UPSTREAM_URL) {
    try {
      const res = await fetch(env.UPSTREAM_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: input.taskId,
          stepIdx: input.stepIdx,
          prompt,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        throw new Error(`upstream failed with ${res.status}`);
      }
      const body = (await res.json()) as { result?: string };
      if (!body.result) {
        throw new Error("upstream missing result");
      }
      return JSON.stringify({
        type: "agent-adapter",
        agentName: env.AGENT_NAME,
        source: "upstream",
        taskId: input.taskId,
        stepIdx: input.stepIdx,
        result: body.result,
        ts: new Date().toISOString(),
      });
    } catch (error) {
      return JSON.stringify({
        type: "agent-adapter",
        agentName: env.AGENT_NAME,
        source: "upstream-error",
        taskId: input.taskId,
        stepIdx: input.stepIdx,
        result: String(error),
        partial: true,
        ts: new Date().toISOString(),
      });
    }
  }

  const stubResult = [
    `[${env.AGENT_NAME}]`,
    `task=${input.taskId} step=${input.stepIdx}`,
    `prompt=${prompt.slice(0, 500)}`,
    "Wire UPSTREAM_URL to Cursor SDK, MCP, or any runtime that returns { result }.",
  ].join("\n");

  return JSON.stringify({
    type: "agent-adapter",
    agentName: env.AGENT_NAME,
    source: "stub",
    taskId: input.taskId,
    stepIdx: input.stepIdx,
    result: stubResult,
    ts: new Date().toISOString(),
  });
}
