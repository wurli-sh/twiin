import { describe, expect, it } from "vitest";
import { buildGenericTemplates } from "../plan-templates";
import { NativeConfigId } from "../constants";

describe("plan-templates", () => {
  it("includes research template for research goals", () => {
    const templates = buildGenericTemplates("research whether I should LP");
    expect(templates.some((t) => t.label === "research")).toBe(true);
  });

  it("always includes best-effort fallback", () => {
    const templates = buildGenericTemplates("hello world");
    const best = templates.find((t) => t.label === "best-effort");
    expect(best?.steps[0].configId).toBe(NativeConfigId.ANALYSIS);
  });
});
