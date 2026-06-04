import { describe, expect, it } from "vitest";
import { makeSseStream, publish, sseHeaders } from "../src/sse";

describe("sse", () => {
  it("publishes JSON events to subscribers", async () => {
    const stream = makeSseStream({} as never, "42");
    const reader = stream.getReader();

    publish("42", "step_state", { taskId: "42", value: 1n });

    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("id: 1");
    expect(text).toContain("event: step_state");
    expect(text).toContain('"value":"1"');

    await reader.cancel();
  });

  it("returns the expected SSE headers", () => {
    expect(sseHeaders()).toEqual({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
  });

  it("replays missed events after Last-Event-ID", async () => {
    publish("77", "step_state", { taskId: "77", value: 1 });
    publish("77", "step_state", { taskId: "77", value: 2 });

    const stream = makeSseStream({} as never, "77", "1");
    const reader = stream.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);

    expect(text).toContain("id: 2");
    expect(text).toContain('"value":2');
    await reader.cancel();
  });
});
