import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeOnchainLens,
  extractLargeTransfers,
  minTransferSttToWei,
  resolveBlockWindow,
} from "../src/handler";
import type { OnchainLensEnv } from "../src/env";

const baseEnv: OnchainLensEnv = {
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

const THOUSAND_STT_WEI = "0x3635c9adc5dea00000";

function payloadHex(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString("hex");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveBlockWindow", () => {
  it("uses explicit blockWindow when provided", () => {
    expect(resolveBlockWindow({ blockWindow: 5 })).toBe(5);
  });

  it("caps blockWindow at 50", () => {
    expect(resolveBlockWindow({ blockWindow: 100 })).toBe(50);
  });

  it("maps lookbackHours to capped block window", () => {
    expect(resolveBlockWindow({ lookbackHours: 24 })).toBe(50);
    expect(resolveBlockWindow({ lookbackHours: 1 })).toBe(50);
    expect(resolveBlockWindow({ lookbackHours: 0.001 })).toBe(4);
  });

  it("prefers blockWindow over lookbackHours", () => {
    expect(resolveBlockWindow({ blockWindow: 10, lookbackHours: 24 })).toBe(10);
  });

  it("defaults to 20 when no params", () => {
    expect(resolveBlockWindow(undefined)).toBe(20);
  });
});

describe("extractLargeTransfers", () => {
  it("filters and sorts native transfers above threshold", () => {
    const minWei = minTransferSttToWei(1000);
    const result = extractLargeTransfers(
      [
        {
          number: 100,
          txCount: 2,
          gasUsed: "0x0",
          timestamp: 0,
          transactions: [
            {
              hash: "0xsmall",
              from: "0x1111111111111111111111111111111111111111",
              to: "0x2222222222222222222222222222222222222222",
              value: "0x1",
            },
            {
              hash: "0xlarge",
              from: "0x3333333333333333333333333333333333333333",
              to: "0x4444444444444444444444444444444444444444",
              value: THOUSAND_STT_WEI,
            },
          ],
        },
      ],
      minWei,
    );

    expect(result.count).toBe(1);
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0].hash).toBe("0xlarge");
    expect(result.transfers[0].valueStt).toBe(1000);
  });
});

describe("executeOnchainLens", () => {
  it("scans large native transfers when minTransferStt is set", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          method: string;
          params?: unknown[];
        };
        if (body.method === "eth_blockNumber") {
          return { ok: true, json: async () => ({ result: "0x64" }) };
        }
        if (body.method === "eth_getBlockByNumber") {
          const fullTxs = body.params?.[1] === true;
          return {
            ok: true,
            json: async () => ({
              result: {
                number: body.params?.[0],
                transactions: fullTxs
                  ? [
                      {
                        hash: "0xlarge",
                        from: "0x3333333333333333333333333333333333333333",
                        to: "0x4444444444444444444444444444444444444444",
                        value: THOUSAND_STT_WEI,
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

    const result = await executeOnchainLens({
      taskId: "1",
      stepIdx: 0,
      payloadHex: payloadHex({ blockWindow: 3, minTransferStt: 1000 }),
      env: baseEnv,
    });

    const parsed = JSON.parse(result);
    expect(parsed.type).toBe("onchain-lens");
    expect(parsed.largeTransferCount).toBe(3);
    expect(parsed.largeTransfers).toHaveLength(3);
    expect(parsed.summary).toContain("found 3 native transfers >= 1000 STT");
    expect(parsed.transferScanNote).toContain("native STT");
    expect(parsed.findings.some((f: string) => f.includes("Large native transfers"))).toBe(true);
  });

  it("reports zero large transfers with quiet-network finding", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          method: string;
          params?: unknown[];
        };
        if (body.method === "eth_blockNumber") {
          return { ok: true, json: async () => ({ result: "0x64" }) };
        }
        if (body.method === "eth_getBlockByNumber") {
          const fullTxs = body.params?.[1] === true;
          return {
            ok: true,
            json: async () => ({
              result: {
                number: body.params?.[0],
                transactions: fullTxs
                  ? [
                      {
                        hash: "0xsmall",
                        from: "0x1111111111111111111111111111111111111111",
                        to: "0x2222222222222222222222222222222222222222",
                        value: "0x1",
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

    const result = await executeOnchainLens({
      taskId: "2",
      stepIdx: 0,
      payloadHex: payloadHex({ blockWindow: 2, minTransferStt: 1000 }),
      env: baseEnv,
    });

    const parsed = JSON.parse(result);
    expect(parsed.largeTransferCount).toBe(0);
    expect(parsed.findings.some((f: string) => f.includes("quiet-network"))).toBe(true);
  });

  it("uses lightweight block fetch when minTransferStt is omitted", async () => {
    const getBlockCalls: boolean[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          method: string;
          params?: unknown[];
        };
        if (body.method === "eth_blockNumber") {
          return { ok: true, json: async () => ({ result: "0x64" }) };
        }
        if (body.method === "eth_getBlockByNumber") {
          getBlockCalls.push(body.params?.[1] === true);
          return {
            ok: true,
            json: async () => ({
              result: {
                number: body.params?.[0],
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

    const result = await executeOnchainLens({
      taskId: "3",
      stepIdx: 0,
      payloadHex: payloadHex({ blockWindow: 3 }),
      env: baseEnv,
    });

    const parsed = JSON.parse(result);
    expect(parsed.largeTransferCount).toBeUndefined();
    expect(parsed.totalTxSampled).toBe(6);
    expect(getBlockCalls.every((full) => full === false)).toBe(true);
  });
});
