import { afterEach, describe, expect, it, vi } from "vitest";
import { createExternalApp } from "@twiin/external-kit";
import { executeDocsLens } from "../src/handler";
import type { DocsLensEnv } from "../src/env";

const testEnv: DocsLensEnv = {
  EXTERNAL_PRIVATE_KEY:
    "0x59c6995e998f97a5a0044966f0945382dbb5b2d0d7e54d99f7f9a0b7f8d6d7f0",
  SOMNIA_RPC_URL: "https://dream-rpc.somnia.network/",
  HOST: "127.0.0.1",
  PORT: 3011,
  EXTERNAL_PUBLIC_URL: "http://127.0.0.1:3011",
  AGENT_NAME: "docs-lens@twiin",
  AGENT_COST_STT: "0.15",
  REGISTRATION_DEPOSIT_STT: "5",
  AGENT_COST_WEI: 150000000000000000n,
  REGISTRATION_DEPOSIT_WEI: 5000000000000000000n,
};

const app = createExternalApp({
  env: testEnv,
  capabilityNames: ["data.specialized"],
  execute: executeDocsLens,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("docs-lens app", () => {
  it("returns a health payload with registrant", async () => {
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "ok",
      agentName: "docs-lens@twiin",
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

  it("returns a signed execute result with mocked docs fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "Somnia agents support JSON API and LLM inference.",
      }),
    );

    const payload = Buffer.from(
      JSON.stringify({
        question: "What agents does Somnia expose?",
        docPath: "developer/building-dapps",
      }),
    ).toString("hex");

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
    expect(body).toMatchObject({
      registrant: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
      signature: expect.stringMatching(/^0x[0-9a-fA-F]+$/),
    });

    const parsed = JSON.parse(body.result);
    expect(parsed.type).toBe("docs-lens");
    expect(parsed.docPath).toBe("developer/building-dapps");
  });
});
