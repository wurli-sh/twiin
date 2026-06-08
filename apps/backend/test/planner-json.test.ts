import { describe, expect, it } from "vitest";
import { parsePlannerStepsFromToolInput, parsePlannerStepsJson } from "../src/planner-json";

describe("parsePlannerStepsJson", () => {
  const step = {
    configId: 2,
    payload: '{"url":"https://example.com","path":"ok"}',
    maxCostWei: "120000000000000000",
    timeoutSeconds: 120,
  };

  it("parses a bare JSON array", () => {
    const out = parsePlannerStepsJson(JSON.stringify([step]));
    expect(out).toHaveLength(1);
    expect(out[0].configId).toBe(2);
  });

  it("parses fenced JSON and ignores trailing prose", () => {
    const raw = `\`\`\`json
${JSON.stringify([step], null, 2)}
\`\`\`

Here is a summary of the plan for the user.`;
    const out = parsePlannerStepsJson(raw);
    expect(out).toHaveLength(1);
  });

  it("parses array with trailing text after closing bracket", () => {
    const raw = `${JSON.stringify([step])}\n\nNote: use oracle only.`;
    const out = parsePlannerStepsJson(raw);
    expect(out[0].configId).toBe(2);
  });

  it("returns tool input steps", () => {
    const out = parsePlannerStepsFromToolInput({
      steps: [
        {
          configId: 3,
          payload: "analyze",
          maxCostWei: "1",
          timeoutSeconds: 120,
        },
      ],
    });
    expect(out[0].configId).toBe(3);
  });

  it("rejects plans with more than 5 steps", () => {
    const tooMany = Array.from({ length: 6 }, (_, i) => ({
      configId: 3,
      payload: `step ${i}`,
      timeoutSeconds: 120,
    }));
    expect(() => parsePlannerStepsFromToolInput({ steps: tooMany })).toThrow();
    expect(() => parsePlannerStepsJson(JSON.stringify(tooMany))).toThrow();
  });
});
