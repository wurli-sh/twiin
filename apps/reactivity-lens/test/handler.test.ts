import { afterEach, describe, expect, it, vi } from "vitest";
import addressesRaw from "@twiin/shared/addresses.json";
import { parseAbiItem, toEventSelector } from "viem";
import {
  executeReactivityLens,
  MAX_RPC_BLOCK_RANGE,
  parseReactivityPayload,
} from "../src/handler";

const REFRESH_SCHEDULED_TOPIC = toEventSelector(
  parseAbiItem(
    "event RefreshScheduled(uint256 indexed personalAgentId, string topic, uint256 timestampMillis, uint256 subscriptionId)",
  ),
);
const REFRESH_SKIPPED_TOPIC = toEventSelector(
  parseAbiItem(
    "event RefreshSkipped(uint256 indexed personalAgentId, string topic, string reason)",
  ),
);
import type { ReactivityLensEnv } from "../src/env";

const baseEnv: ReactivityLensEnv = {
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

function payloadHex(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString("hex");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reactivity lens helpers", () => {
  it("parses payload with defaults", () => {
    expect(parseReactivityPayload({ lookbackBlocks: 500 })).toEqual({
      agentId: undefined,
      topic: undefined,
      lookbackBlocks: 500,
    });
    expect(parseReactivityPayload(null).lookbackBlocks).toBe(MAX_RPC_BLOCK_RANGE);
    expect(parseReactivityPayload({ lookbackBlocks: 3000 }).lookbackBlocks).toBe(
      MAX_RPC_BLOCK_RANGE,
    );
  });
});

describe("executeReactivityLens", () => {
  it("returns structured reactivity snapshot on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          method: string;
          params?: unknown[];
        };

        if (body.method === "eth_blockNumber") {
          return { ok: true, json: async () => ({ result: "0x3e8" }) };
        }
        if (body.method === "eth_getLogs") {
          const params = body.params?.[0] as { address?: string; topics?: string[] };
          if (params.address === addressesRaw.oracleFeed) {
            return {
              ok: true,
              json: async () => ({
                result: [
                  {
                    blockNumber: "0x3e0",
                    topics: [
                      "0xfeed",
                      "0x0000000000000000000000000000000000000000000000000000000000000001",
                    ],
                  },
                ],
              }),
            };
          }
          if (params.address === addressesRaw.refreshManager) {
            if (params.topics?.[0] === REFRESH_SCHEDULED_TOPIC) {
              return {
                ok: true,
                json: async () => ({
                  result: [{ blockNumber: "0x3df", topics: ["0xsched", "0x02"] }],
                }),
              };
            }
            if (params.topics?.[0] === REFRESH_SKIPPED_TOPIC) {
              return {
                ok: true,
                json: async () => ({
                  result: [{ blockNumber: "0x3de", topics: ["0xskip", "0x03"] }],
                }),
              };
            }
          }
        }
        throw new Error(`unexpected RPC method ${body.method}`);
      }),
    );

    const result = await executeReactivityLens({
      taskId: "1",
      stepIdx: 0,
      payloadHex: payloadHex({ lookbackBlocks: 100 }),
      env: baseEnv,
    });

    const parsed = JSON.parse(result);
    expect(parsed).toMatchObject({
      type: "reactivity-lens",
      agentName: "reactivity-lens@twiin",
      source: "somnia-reactivity",
      lookbackBlocks: 100,
    });
    expect(parsed.refreshEvents.feedPublished).toBe(1);
    expect(parsed.refreshEvents.scheduled).toBe(1);
    expect(parsed.refreshEvents.skipped).toBe(1);
    expect(parsed.feedsSampled).toHaveLength(0);
    expect(parsed.findings.length).toBeGreaterThan(0);
    expect(parsed.blocksScanned).toBe(101);
    expect(parsed.summary).toContain("FeedPublished");
  });

  it("returns clear metadata when no events are found in window", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { method: string };
        if (body.method === "eth_blockNumber") {
          return { ok: true, json: async () => ({ result: "0x1869f" }) };
        }
        if (body.method === "eth_getLogs") {
          return { ok: true, json: async () => ({ result: [] }) };
        }
        throw new Error(`unexpected RPC method ${body.method}`);
      }),
    );

    const result = await executeReactivityLens({
      taskId: "3",
      stepIdx: 1,
      payloadHex: payloadHex({ lookbackBlocks: 1000 }),
      env: baseEnv,
    });

    const parsed = JSON.parse(result);
    expect(parsed.blocksScanned).toBe(1001);
    expect(parsed.refreshEvents.feedPublished).toBe(0);
    expect(parsed.refreshEvents.scheduled).toBe(0);
    expect(parsed.refreshEvents.skipped).toBe(0);
    expect(parsed.summary).toContain("0 FeedPublished");
    expect(parsed.findings[0]).toContain("blocks scanned via eth_getLogs");
    expect(parsed.findings[2]).toContain("quiet window is valid");
  });

  it("uses fromBlock 0 when chain head is below lookbackBlocks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { method: string };
        if (body.method === "eth_blockNumber") {
          return { ok: true, json: async () => ({ result: "0x64" }) };
        }
        if (body.method === "eth_getLogs") {
          return { ok: true, json: async () => ({ result: [] }) };
        }
        throw new Error(`unexpected RPC method ${body.method}`);
      }),
    );

    const result = await executeReactivityLens({
      taskId: "4",
      stepIdx: 0,
      payloadHex: payloadHex({ lookbackBlocks: 1000 }),
      env: baseEnv,
    });

    const parsed = JSON.parse(result);
    expect(parsed.fromBlock).toBe("0");
    expect(parsed.latestBlock).toBe("100");
    expect(parsed.blocksScanned).toBe(101);
  });

  it("returns structured error when RPC fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("rpc unavailable")),
    );

    const result = await executeReactivityLens({
      taskId: "2",
      stepIdx: 0,
      payloadHex: payloadHex({ lookbackBlocks: 100 }),
      env: baseEnv,
    });

    const parsed = JSON.parse(result);
    expect(parsed.type).toBe("external-error");
    expect(parsed.partial.lookbackBlocks).toBe(100);
  });
});
