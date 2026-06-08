import { afterEach, describe, expect, it, vi } from "vitest";
import { createExternalApp } from "@twiin/external-kit";
import { executeOnchainLens } from "../src/handler";
import type { OnchainLensEnv } from "../src/env";

const testEnv: OnchainLensEnv = {
  EXTERNAL_PRIVATE_KEY:
    "0x59c6995e998f97a5a0044966f0945382dbb5b2d0d7e54d99f7f9a0b7f8d6d7f0",
  SOMNIA_RPC_URL: "https://dream-rpc.somnia.network/",
  HOST: "127.0.0.1",
  PORT: 3013,
  EXTERNAL_PUBLIC_URL: "http://127.0.0.1:3013",
  AGENT_NAME: "onchain-lens@twiin",
  AGENT_COST_STT: "0.16",
  REGISTRATION_DEPOSIT_STT: "5",
  AGENT_COST_WEI: 160000000000000000n,
  REGISTRATION_DEPOSIT_WEI: 5000000000000000000n,
};

const app = createExternalApp({
  env: testEnv,
  capabilityNames: ["data.specialized"],
  execute: executeOnchainLens,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("onchain-lens app", () => {
  it("returns a health payload with registrant", async () => {
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "ok",
      agentName: "onchain-lens@twiin",
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
        const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
        if (body.method === "eth_blockNumber") {
          return {
            ok: true,
            json: async () => ({ result: "0x64" }),
          };
        }
        if (body.method === "eth_getBlockByNumber") {
          return {
            ok: true,
            json: async () => ({
              result: {
                number: body.params[0],
                transactions: [{}, {}],
                gasUsed: "0x5208",
                timestamp: "0x5f5e100",
              },
            }),
          };
        }
        throw new Error(`unexpected RPC method ${body.method}`);
      }),
    );

    const payload = Buffer.from(JSON.stringify({ blockWindow: 3 })).toString("hex");
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
    const parsed = JSON.parse(body.result);
    expect(parsed.type).toBe("onchain-lens");
    expect(parsed.latestBlock).toBe(100);
    expect(parsed.blockWindow).toBe(3);
    expect(parsed.totalTxSampled).toBe(6);
  });

  it("returns transfer scan metadata when minTransferStt is set", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
        if (body.method === "eth_blockNumber") {
          return {
            ok: true,
            json: async () => ({ result: "0x64" }),
          };
        }
        if (body.method === "eth_getBlockByNumber") {
          const fullTxs = body.params[1] === true;
          return {
            ok: true,
            json: async () => ({
              result: {
                number: body.params[0],
                transactions: fullTxs
                  ? [
                      {
                        hash: "0xlarge",
                        from: "0x3333333333333333333333333333333333333333",
                        to: "0x4444444444444444444444444444444444444444",
                        value: "0x3635c9adc5dea00000",
                      },
                    ]
                  : ["0xhash"],
                gasUsed: "0x5208",
                timestamp: "0x5f5e100",
              },
            }),
          };
        }
        throw new Error(`unexpected RPC method ${body.method}`);
      }),
    );

    const payload = Buffer.from(
      JSON.stringify({ blockWindow: 2, minTransferStt: 1000 }),
    ).toString("hex");
    const res = await app.request("/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "100",
        stepIdx: 0,
        payload,
        reqId: "0x" + "cd".repeat(32),
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = JSON.parse(body.result);
    expect(parsed.largeTransferCount).toBe(2);
    expect(parsed.summary).toContain("native transfers");
  });
});
