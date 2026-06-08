import { afterEach, describe, expect, it, vi } from "vitest";
import { createExternalApp } from "@twiin/external-kit";
import { executeAgentAdapter } from "../src/handler";
import type { AgentAdapterEnv } from "../src/env";

const testEnv: AgentAdapterEnv = {
  EXTERNAL_PRIVATE_KEY:
    "0x59c6995e998f97a5a0044966f0945382dbb5b2d0d7e54d99f7f9a0b7f8d6d7f0",
  SOMNIA_RPC_URL: "https://dream-rpc.somnia.network/",
  HOST: "127.0.0.1",
  PORT: 8790,
  EXTERNAL_PUBLIC_URL: "http://127.0.0.1:8790",
  AGENT_NAME: "agent-adapter@twiin",
  AGENT_COST_STT: "0.20",
  REGISTRATION_DEPOSIT_STT: "5",
  AGENT_COST_WEI: 200000000000000000n,
  REGISTRATION_DEPOSIT_WEI: 5000000000000000000n,
};

const app = createExternalApp({
  env: testEnv,
  capabilityNames: ["data.specialized"],
  execute: executeAgentAdapter,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("agent-adapter app", () => {
  it("returns a health payload with registrant", async () => {
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "ok",
      agentName: "agent-adapter@twiin",
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

  it("returns a signed stub execute result", async () => {
    const payload = Buffer.from("Summarize Somnia agent fees").toString("hex");

    const res = await app.request("/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "99",
        stepIdx: 0,
        payload,
        reqId: "0x" + "ab".repeat(32),
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      registrant: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
      signature: expect.stringMatching(/^0x[0-9a-fA-F]+$/),
    });

    const parsed = JSON.parse(body.result);
    expect(parsed.type).toBe("agent-adapter");
    expect(parsed.source).toBe("stub");
    expect(parsed.result).toContain("Summarize Somnia agent fees");
  });

  it("proxies to upstream when UPSTREAM_URL is set", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: "upstream response text" }),
      }),
    );

    const upstreamEnv: AgentAdapterEnv = {
      ...testEnv,
      UPSTREAM_URL: "http://127.0.0.1:9999/run",
    };
    const upstreamApp = createExternalApp({
      env: upstreamEnv,
      capabilityNames: ["data.specialized"],
      execute: executeAgentAdapter,
    });

    const payload = Buffer.from("test prompt").toString("hex");
    const res = await upstreamApp.request("/execute", {
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
    expect(parsed.source).toBe("upstream");
    expect(parsed.result).toBe("upstream response text");
  });
});
