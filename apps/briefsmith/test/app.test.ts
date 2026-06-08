import { afterEach, describe, expect, it, vi } from "vitest";
import { createExternalApp } from "@twiin/external-kit";
import { executeBriefsmith } from "../src/handler";
import type { BriefsmithEnv } from "../src/env";

const testEnv: BriefsmithEnv = {
  EXTERNAL_PRIVATE_KEY:
    "0x59c6995e998f97a5a0044966f0945382dbb5b2d0d7e54d99f7f9a0b7f8d6d7f0",
  SOMNIA_RPC_URL: "https://dream-rpc.somnia.network/",
  HOST: "127.0.0.1",
  PORT: 3015,
  EXTERNAL_PUBLIC_URL: "http://127.0.0.1:3015",
  AGENT_NAME: "briefsmith@twiin",
  AGENT_COST_STT: "0.22",
  REGISTRATION_DEPOSIT_STT: "5",
  AGENT_COST_WEI: 220000000000000000n,
  REGISTRATION_DEPOSIT_WEI: 5000000000000000000n,
  BRIEFSMITH_MODEL: "claude-3-5-haiku-20241022",
};

const app = createExternalApp({
  env: testEnv,
  capabilityNames: ["data.specialized"],
  execute: executeBriefsmith,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("briefsmith app", () => {
  it("returns a health payload with registrant", async () => {
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "ok",
      agentName: "briefsmith@twiin",
      capabilityNames: ["data.specialized"],
    });
  });

  it("returns a signed verification result for registration challenge", async () => {
    const res = await app.request("/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "0",
        stepIdx: 0,
        payload: "",
        reqId: "0x" + "00".repeat(32),
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      registrant: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
      result: expect.stringContaining("verification"),
      signature: expect.stringMatching(/^0x[0-9a-fA-F]+$/),
    });
  });

  it("returns a signed structured fallback brief when ANTHROPIC_API_KEY is missing", async () => {
    const payload = Buffer.from(
      "Format an executive brief with sections: Executive Summary, Key Metrics, Corroboration Notes, Risks & Gaps, Confidence Score, Sources. Use ONLY prior outputs below. Markdown only. Never invent numbers or dates.\n\nPrevious step outputs:\n- external-9: onchain data\n- external-10: reactivity events",
    ).toString("hex");

    const res = await app.request("/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "99",
        stepIdx: 5,
        payload,
        reqId: "0x" + "ab".repeat(32),
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = JSON.parse(body.result);
    expect(parsed.type).toBe("briefsmith");
    expect(parsed.source).toBe("structured-fallback");
    expect(parsed.brief).toContain("## Executive Summary");
    expect(parsed.brief).toContain("## Key Metrics");
    expect(parsed.brief).toContain("## Confidence Score");
    expect(parsed.brief).toContain("## Sources");
    expect(parsed.publishReady).toBe(true);
  });

  it("returns a signed anthropic brief when API key is set", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "# Executive Brief\n\nKey finding: activity stable." }],
        }),
      }),
    );

    const anthropicEnv: BriefsmithEnv = {
      ...testEnv,
      ANTHROPIC_API_KEY: "test-key",
    };
    const anthropicApp = createExternalApp({
      env: anthropicEnv,
      capabilityNames: ["data.specialized"],
      execute: executeBriefsmith,
    });

    const payload = Buffer.from(JSON.stringify({ goal: "Summarize run" })).toString("hex");
    const res = await anthropicApp.request("/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "1",
        stepIdx: 0,
        payload,
        reqId: "0x" + "cd".repeat(32),
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = JSON.parse(body.result);
    expect(parsed.source).toBe("anthropic-haiku");
    expect(parsed.brief).toContain("Executive Brief");
  });
});
