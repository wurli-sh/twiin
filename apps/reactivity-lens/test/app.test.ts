import { afterEach, describe, expect, it, vi } from "vitest";
import { createExternalApp } from "@twiin/external-kit";
import { executeReactivityLens } from "../src/handler";
import type { ReactivityLensEnv } from "../src/env";

const testEnv: ReactivityLensEnv = {
  EXTERNAL_PRIVATE_KEY:
    "0x59c6995e998f97a5a0044966f0945382dbb5b2d0d7e54d99f7f9a0b7f8d6d7f0",
  SOMNIA_RPC_URL: "https://dream-rpc.somnia.network/",
  HOST: "127.0.0.1",
  PORT: 3016,
  EXTERNAL_PUBLIC_URL: "http://127.0.0.1:3016",
  AGENT_NAME: "reactivity-lens@twiin",
  AGENT_COST_STT: "0.17",
  REGISTRATION_DEPOSIT_STT: "5",
  AGENT_COST_WEI: 170000000000000000n,
  REGISTRATION_DEPOSIT_WEI: 5000000000000000000n,
};

const app = createExternalApp({
  env: testEnv,
  capabilityNames: ["data.specialized"],
  execute: executeReactivityLens,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reactivity-lens app", () => {
  it("returns a health payload with registrant", async () => {
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "ok",
      agentName: "reactivity-lens@twiin",
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

  it("returns a signed execute result with mocked RPC", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { method: string };
        if (body.method === "eth_blockNumber") {
          return { ok: true, json: async () => ({ result: "0x400" }) };
        }
        if (body.method === "eth_getLogs") {
          return { ok: true, json: async () => ({ result: [] }) };
        }
        throw new Error(`unexpected method ${body.method}`);
      }),
    );

    const payload = Buffer.from(JSON.stringify({ lookbackBlocks: 50 })).toString("hex");

    const res = await app.request("/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "12",
        stepIdx: 0,
        payload,
        reqId: "0x" + "12".repeat(32),
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = JSON.parse(body.result);
    expect(parsed.type).toBe("reactivity-lens");
    expect(parsed.lookbackBlocks).toBe(50);
  });
});
