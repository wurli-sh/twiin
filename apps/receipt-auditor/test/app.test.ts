import { afterEach, describe, expect, it, vi } from "vitest";
import { createExternalApp } from "@twiin/external-kit";
import { executeReceiptAuditor } from "../src/handler";
import type { ReceiptAuditorEnv } from "../src/env";

const testEnv: ReceiptAuditorEnv = {
  EXTERNAL_PRIVATE_KEY:
    "0x59c6995e998f97a5a0044966f0945382dbb5b2d0d7e54d99f7f9a0b7f8d6d7f0",
  SOMNIA_RPC_URL: "https://dream-rpc.somnia.network/",
  HOST: "127.0.0.1",
  PORT: 3014,
  EXTERNAL_PUBLIC_URL: "http://127.0.0.1:3014",
  AGENT_NAME: "receipt-auditor@twiin",
  AGENT_COST_STT: "0.14",
  REGISTRATION_DEPOSIT_STT: "5",
  AGENT_COST_WEI: 140000000000000000n,
  REGISTRATION_DEPOSIT_WEI: 5000000000000000000n,
};

const app = createExternalApp({
  env: testEnv,
  capabilityNames: ["data.specialized"],
  execute: executeReceiptAuditor,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("receipt-auditor app", () => {
  it("returns a health payload with registrant", async () => {
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "ok",
      agentName: "receipt-auditor@twiin",
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

  it("returns a signed execute result with mocked receipts API (verified)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            verified: true,
            status: "verified",
            steps: [{ agent: "a" }, { agent: "b" }],
          }),
      }),
    );

    const payload = Buffer.from(JSON.stringify({ receiptId: "req-123" })).toString("hex");
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
    expect(parsed.type).toBe("receipt-auditor");
    expect(parsed.requestId).toBe("req-123");
    expect(parsed.summary.verified).toBe(true);
    expect(parsed.summary.agentCount).toBe(2);
  });

  it("returns a signed execute result with mocked receipts API (unverified)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: "pending" }),
      }),
    );

    const payload = Buffer.from(JSON.stringify({ receiptId: "latest" })).toString("hex");
    const res = await app.request("/execute", {
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
    expect(parsed.summary.verified).toBe(false);
    expect(parsed.findings[0]).toContain("unverified or partial");
  });

  it("returns structured error on fetch failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const payload = Buffer.from(JSON.stringify({ receiptId: "latest" })).toString("hex");
    const res = await app.request("/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "2",
        stepIdx: 0,
        payload,
        reqId: "0x" + "ef".repeat(32),
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = JSON.parse(body.result);
    expect(parsed.type).toBe("external-error");
    expect(parsed.partial).toMatchObject({ requestId: "latest", partial: true });
  });
});
