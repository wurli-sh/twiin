import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildFindings,
  buildLpRiskHints,
  buildOrderbookProxy,
  executeDreamdex,
  extractCoingeckoMetrics,
  filterPairsForResponse,
  parseCoingeckoId,
  parseMarketRequest,
  pickBestPair,
  type DexPair,
} from "../src/handler";
import type { DreamdexEnv } from "../src/env";

const baseEnv: DreamdexEnv = {
  EXTERNAL_PRIVATE_KEY:
    "0x59c6995e998f97a5a0044966f0945382dbb5b2d0d7e54d99f7f9a0b7f8d6d7f0",
  SOMNIA_RPC_URL: "https://dream-rpc.somnia.network/",
  HOST: "127.0.0.1",
  PORT: 3012,
  EXTERNAL_PUBLIC_URL: "http://127.0.0.1:3012",
  AGENT_NAME: "dreamdex-mcp@twiin",
  AGENT_COST_STT: "0.20",
  REGISTRATION_DEPOSIT_STT: "5",
  AGENT_COST_WEI: 200000000000000000n,
  REGISTRATION_DEPOSIT_WEI: 5000000000000000000n,
};

function withEnv(overrides: Partial<DreamdexEnv> = {}): DreamdexEnv {
  return { ...baseEnv, ...overrides };
}

function payloadHex(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString("hex");
}

const somniaPair: DexPair = {
  chainId: "somnia",
  dexId: "dreamdex",
  baseToken: { symbol: "SOMI", name: "Somnia" },
  quoteToken: { symbol: "USDC" },
  priceUsd: "0.006800",
  liquidity: { usd: 89_100 },
  volume: { h24: 12_300 },
  priceChange: { h24: -2.1 },
};

const ethPair: DexPair = {
  chainId: "ethereum",
  dexId: "uniswap",
  baseToken: { symbol: "SOMI" },
  quoteToken: { symbol: "USDC" },
  priceUsd: "0.40",
  liquidity: { usd: 500_000 },
  volume: { h24: 80_000 },
  priceChange: { h24: 1.2 },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dreamdex helpers", () => {
  it("parses action and pair from planner payload", () => {
    expect(parseMarketRequest({ action: "coingecko", id: "somnia" })).toEqual({
      action: "coingecko",
      pair: "SOMI",
    });
    expect(parseMarketRequest({ action: "orderbook", pair: "SOMI/USDC" })).toEqual({
      action: "orderbook",
      pair: "SOMI/USDC",
    });
    expect(parseMarketRequest({ symbol: "SOMI" })).toEqual({
      action: "snapshot",
      pair: "SOMI",
    });
    expect(parseMarketRequest(null)).toEqual({
      action: "snapshot",
      pair: "SOMI",
    });
  });

  it("prefers Somnia/dreamDEX pairs over higher-liquidity off-chain matches", () => {
    const { top, chainWarning } = pickBestPair([ethPair, somniaPair]);
    expect(top?.chainId).toBe("somnia");
    expect(chainWarning).toBeNull();
  });

  it("warns when no Somnia pair exists", () => {
    const { top, chainWarning } = pickBestPair([ethPair]);
    expect(top?.chainId).toBe("ethereum");
    expect(chainWarning).toContain("No Somnia/dreamDEX pair found");
  });

  it("builds LP risk hints from liquidity and volume", () => {
    expect(buildLpRiskHints({
      symbol: "SOMI",
      liquidityUsd: 89_100,
      volume24h: 12_300,
      change24h: -2.1,
    })).toEqual(
      expect.arrayContaining([
        "Liquidity above $50K — moderate depth for typical LP sizes",
      ]),
    );
  });

  it("builds orderbook proxy from top pair", () => {
    expect(
      buildOrderbookProxy({
        symbol: "SOMI",
        priceUsd: "0.42",
        liquidityUsd: 89_100,
      }),
    ).toMatchObject({
      midPrice: "0.42",
      depthUsd: 89_100,
      note: expect.stringContaining("DexScreener proxy"),
    });
  });

  it("caps orderbook pairs to two Somnia matches", () => {
    const pairs = filterPairsForResponse(
      [ethPair, somniaPair, { ...somniaPair, dexId: "dreamdex-2" }],
      { action: "orderbook", pair: "SOMI/USDC" },
    );
    expect(pairs).toHaveLength(2);
    expect(pairs.every((pair) => pair.chainId === "somnia")).toBe(true);
  });

  it("parses coingecko id with somnia default", () => {
    expect(parseCoingeckoId({ action: "coingecko" })).toBe("somnia");
    expect(parseCoingeckoId({ action: "coingecko", id: "bitcoin" })).toBe("bitcoin");
  });

  it("extracts coingecko metrics from API shape", () => {
    expect(
      extractCoingeckoMetrics(
        {
          somnia: {
            usd: 0.76,
            usd_market_cap: 1_200_000_000,
            usd_24h_vol: 45_000_000,
            usd_24h_change: -1.2,
          },
        },
        "somnia",
      ),
    ).toEqual({
      usd: 0.76,
      usd_market_cap: 1_200_000_000,
      usd_24h_vol: 45_000_000,
      usd_24h_change: -1.2,
    });
  });

  it("includes orderbook note in findings for orderbook action", () => {
    const findings = buildFindings(
      { action: "orderbook", pair: "SOMI/USDC" },
      {
        symbol: "SOMI",
        priceUsd: "0.42",
        volume24h: 12_300,
        liquidityUsd: 89_100,
        dex: "dreamdex",
        chain: "somnia",
      },
      null,
    );
    expect(findings.some((line) => line.includes("Orderbook-style snapshot"))).toBe(true);
  });
});

describe("executeDreamdex", () => {
  it("returns DexScreener success with Somnia pair preferred and price corrected by CoinGecko", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ pairs: [ethPair, somniaPair] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            somnia: { usd: 0.114893, usd_market_cap: 1_200_000_000, usd_24h_vol: 45_000_000, usd_24h_change: -1.2 },
          }),
        }),
    );

    const result = await executeDreamdex({
      taskId: "1",
      stepIdx: 0,
      payloadHex: payloadHex({ action: "orderbook", pair: "SOMI/USDC" }),
      reqId: "0x" + "11".repeat(32),
      env: baseEnv,
    });

    const parsed = JSON.parse(result);
    expect(parsed).toMatchObject({
      type: "dreamdex-mcp",
      agentName: "dreamdex-mcp@twiin",
      source: "dexscreener",
      action: "orderbook",
      pair: "SOMI/USDC",
      topPair: {
        symbol: "SOMI",
        chain: "somnia",
        dex: "dreamdex",
        priceUsd: "0.114893",
      },
    });
    expect(parsed.orderbook).toMatchObject({
      midPrice: "0.114893",
      note: expect.stringContaining("DexScreener proxy"),
    });
    expect(parsed.findings[0]).toContain("price-corrected");
    expect(parsed.findings[0]).toContain("0.114893");
    expect(parsed.lpRiskHints.length).toBeGreaterThan(0);
    expect(parsed.pairs.length).toBeLessThanOrEqual(2);
  });

  it("keeps DexScreener price when CoinGecko overlay fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ pairs: [ethPair, somniaPair] }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
        }),
    );

    const result = await executeDreamdex({
      taskId: "1",
      stepIdx: 0,
      payloadHex: payloadHex({ action: "orderbook", pair: "SOMI/USDC" }),
      reqId: "0x" + "11".repeat(32),
      env: baseEnv,
    });

    const parsed = JSON.parse(result);
    expect(parsed.topPair.priceUsd).toBe("0.006800");
    expect(parsed.orderbook.midPrice).toBe("0.006800");
    expect(parsed.findings[0]).not.toContain("price-corrected");
  });

  it("does not apply CoinGecko overlay for non-Somnia pairs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ pairs: [ethPair] }),
      }),
    );

    const result = await executeDreamdex({
      taskId: "2",
      stepIdx: 0,
      payloadHex: payloadHex({ action: "orderbook", pair: "SOMI/USDC" }),
      reqId: "0x" + "22".repeat(32),
      env: baseEnv,
    });

    const parsed = JSON.parse(result);
    expect(parsed.topPair.priceUsd).toBe("0.40");
    expect(parsed.topPair.chain).toBe("ethereum");
    expect(parsed.findings.some((f: string) => f.includes("No Somnia/dreamDEX pair found"))).toBe(true);
  });

  it("returns structured findings when DexScreener has no pairs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ pairs: [] }),
      }),
    );

    const result = await executeDreamdex({
      taskId: "2",
      stepIdx: 0,
      payloadHex: payloadHex({ action: "pairs", pair: "UNKNOWN/XYZ" }),
      reqId: "0x" + "22".repeat(32),
      env: baseEnv,
    });

    const parsed = JSON.parse(result);
    expect(parsed.type).toBe("dreamdex-mcp");
    expect(parsed.topPair).toBeNull();
    expect(parsed.findings).toEqual(["No DexScreener pairs found for UNKNOWN/XYZ"]);
  });

  it("falls through to DexScreener when MCP URL fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 502 })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ pairs: [somniaPair] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            somnia: { usd: 0.114893, usd_market_cap: 1_200_000_000, usd_24h_vol: 45_000_000, usd_24h_change: -1.2 },
          }),
        }),
    );

    const result = await executeDreamdex({
      taskId: "3",
      stepIdx: 0,
      payloadHex: payloadHex({ action: "orderbook", pair: "SOMI/USDC" }),
      reqId: "0x" + "33".repeat(32),
      env: withEnv({ DREAMDEX_MCP_URL: "https://mcp.dreamdex.example/query" }),
    });

    const parsed = JSON.parse(result);
    expect(parsed.source).toBe("dexscreener");
    expect(parsed.findings.some((f: string) => f.includes("dreamDEX MCP unavailable"))).toBe(true);
    expect(parsed.topPair?.chain).toBe("somnia");
  });

  it("returns CoinGecko success for coingecko action", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          somnia: {
            usd: 0.76,
            usd_market_cap: 1_200_000_000,
            usd_24h_vol: 45_000_000,
            usd_24h_change: -1.2,
          },
        }),
      }),
    );

    const result = await executeDreamdex({
      taskId: "5",
      stepIdx: 2,
      payloadHex: payloadHex({ action: "coingecko", id: "somnia" }),
      reqId: "0x" + "55".repeat(32),
      env: baseEnv,
    });

    const parsed = JSON.parse(result);
    expect(parsed).toMatchObject({
      type: "dreamdex-mcp",
      source: "coingecko",
      action: "coingecko",
      id: "somnia",
      somnia: {
        usd: 0.76,
        usd_24h_change: -1.2,
      },
    });
    expect(parsed.findings.length).toBeGreaterThan(0);
  });

  it("returns structured error when CoinGecko fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
      }),
    );

    const result = await executeDreamdex({
      taskId: "6",
      stepIdx: 2,
      payloadHex: payloadHex({ action: "coingecko", id: "somnia" }),
      reqId: "0x" + "66".repeat(32),
      env: baseEnv,
    });

    const parsed = JSON.parse(result);
    expect(parsed.type).toBe("external-error");
    expect(parsed.error).toContain("CoinGecko 429");
    expect(parsed.partial).toMatchObject({
      action: "coingecko",
      id: "somnia",
      partial: true,
    });
  });

  it("returns structured error when DexScreener fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      }),
    );

    const result = await executeDreamdex({
      taskId: "4",
      stepIdx: 0,
      payloadHex: payloadHex({ action: "orderbook", pair: "SOMI/USDC" }),
      reqId: "0x" + "44".repeat(32),
      env: baseEnv,
    });

    const parsed = JSON.parse(result);
    expect(parsed.type).toBe("external-error");
    expect(parsed.error).toContain("DexScreener 503");
    expect(parsed.partial).toMatchObject({
      action: "orderbook",
      pair: "SOMI/USDC",
      partial: true,
    });
  });
});
