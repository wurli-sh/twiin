import {
  parsePayload,
  structuredError,
  type ExternalExecuteInput,
} from "@twiin/external-kit";
import type { DreamdexEnv } from "./env";

export type MarketAction = "orderbook" | "pairs" | "snapshot" | "coingecko";

export const COINGECKO_SIMPLE_PRICE_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=somnia&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true";

export type DexPair = {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: { symbol?: string; name?: string };
  quoteToken?: { symbol?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  priceChange?: { h24?: number };
};

export type MarketRequest = {
  action: MarketAction;
  pair: string;
};

export type TopPairSummary = {
  symbol?: string;
  name?: string;
  quote?: string;
  priceUsd?: string;
  liquidityUsd?: number;
  volume24h?: number;
  change24h?: number;
  dex?: string;
  chain?: string;
};

export type CoingeckoCoinMetrics = {
  usd?: number;
  usd_market_cap?: number;
  usd_24h_vol?: number;
  usd_24h_change?: number;
};

export function parseMarketRequest(json: Record<string, unknown> | null): MarketRequest {
  const rawAction = typeof json?.action === "string" ? json.action.toLowerCase() : "snapshot";
  const action: MarketAction =
    rawAction === "orderbook" || rawAction === "pairs" || rawAction === "coingecko"
      ? rawAction
      : "snapshot";
  const pair =
    typeof json?.pair === "string"
      ? json.pair
      : typeof json?.symbol === "string"
        ? json.symbol
        : "SOMI";
  return { action, pair };
}

export function parseCoingeckoId(json: Record<string, unknown> | null): string {
  if (typeof json?.id === "string" && json.id.trim()) return json.id.trim();
  return "somnia";
}

export function buildCoingeckoUrl(coinId: string): string {
  const params = new URLSearchParams({
    ids: coinId,
    vs_currencies: "usd",
    include_market_cap: "true",
    include_24hr_vol: "true",
    include_24hr_change: "true",
  });
  return `https://api.coingecko.com/api/v3/simple/price?${params.toString()}`;
}

export function extractCoingeckoMetrics(
  data: Record<string, unknown>,
  coinId: string,
): CoingeckoCoinMetrics | null {
  const coin = data[coinId];
  if (!coin || typeof coin !== "object") return null;
  const row = coin as Record<string, unknown>;
  return {
    usd: typeof row.usd === "number" ? row.usd : undefined,
    usd_market_cap: typeof row.usd_market_cap === "number" ? row.usd_market_cap : undefined,
    usd_24h_vol: typeof row.usd_24h_vol === "number" ? row.usd_24h_vol : undefined,
    usd_24h_change: typeof row.usd_24h_change === "number" ? row.usd_24h_change : undefined,
  };
}

export function isSomniaDreamPair(pair: DexPair): boolean {
  const chain = (pair.chainId ?? "").toLowerCase();
  const dex = (pair.dexId ?? "").toLowerCase();
  return chain === "somnia" || dex.includes("dream");
}

export function pickBestPair(pairs: DexPair[]): {
  top: DexPair | null;
  chainWarning: string | null;
} {
  if (pairs.length === 0) return { top: null, chainWarning: null };

  const somniaMatches = pairs.filter(isSomniaDreamPair);
  if (somniaMatches.length > 0) {
    const sorted = [...somniaMatches].sort(
      (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
    );
    return { top: sorted[0] ?? null, chainWarning: null };
  }

  const sorted = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const top = sorted[0] ?? null;
  return {
    top,
    chainWarning: top
      ? `No Somnia/dreamDEX pair found; using best match on ${top.chainId ?? "unknown"} (${top.dexId ?? "unknown"})`
      : null,
  };
}

export function toTopPairSummary(pair: DexPair): TopPairSummary {
  return {
    symbol: pair.baseToken?.symbol,
    name: pair.baseToken?.name,
    quote: pair.quoteToken?.symbol,
    priceUsd: pair.priceUsd,
    liquidityUsd: pair.liquidity?.usd,
    volume24h: pair.volume?.h24,
    change24h: pair.priceChange?.h24,
    dex: pair.dexId,
    chain: pair.chainId,
  };
}

export function formatNum(value?: number): string {
  if (value == null || Number.isNaN(value)) return "?";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(2);
}

export function buildLpRiskHints(top: TopPairSummary | null): string[] {
  if (!top) return ["No pair data available for LP risk assessment"];

  const hints: string[] = [];
  const liquidity = top.liquidityUsd ?? 0;
  const volume = top.volume24h ?? 0;

  if (liquidity > 0 && liquidity < 50_000) {
    hints.push("Liquidity below $50K — elevated impermanent-loss and slippage risk");
  } else if (liquidity >= 50_000) {
    hints.push("Liquidity above $50K — moderate depth for typical LP sizes");
  }

  if (liquidity > 0 && volume > 0) {
    const ratio = volume / liquidity;
    if (ratio >= 0.5) {
      hints.push("24h volume/liquidity ratio healthy — active trading relative to depth");
    } else if (ratio < 0.1) {
      hints.push("Low 24h volume vs liquidity — thin activity may widen spreads");
    }
  }

  if (top.change24h != null && top.change24h <= -10) {
    hints.push("24h price down >10% — elevated short-term LP drawdown risk");
  } else if (top.change24h != null && top.change24h >= 10) {
    hints.push("24h price up >10% — rebalancing pressure on LP positions");
  }

  if (hints.length === 0) {
    hints.push("Insufficient metrics for detailed LP risk hints");
  }

  return hints;
}

export function buildFindings(
  request: MarketRequest,
  top: TopPairSummary | null,
  chainWarning: string | null,
): string[] {
  const findings: string[] = [];

  if (chainWarning) findings.push(chainWarning);

  if (!top) {
    findings.push(`No DexScreener pairs found for ${request.pair}`);
    return findings;
  }

  const label = top.symbol ?? request.pair;
  findings.push(
    `${label} ~$${top.priceUsd ?? "?"} on ${top.dex ?? "unknown"} (${top.chain ?? "unknown"})`,
  );
  findings.push(
    `24h volume $${formatNum(top.volume24h)} · liquidity $${formatNum(top.liquidityUsd)}`,
  );

  if (request.action === "orderbook") {
    findings.push("Orderbook-style snapshot: pair depth inferred from liquidity and 24h volume");
  }

  return findings;
}

export type OrderbookProxy = {
  midPrice: string | null;
  spreadBps: number | null;
  depthUsd: number | null;
  note: string;
};

export function buildOrderbookProxy(top: TopPairSummary | null): OrderbookProxy | null {
  if (!top) return null;
  return {
    midPrice: top.priceUsd ?? null,
    spreadBps: null,
    depthUsd: top.liquidityUsd ?? null,
    note: "DexScreener proxy — no native L2 book",
  };
}

export function filterPairsForResponse(pairs: DexPair[], request: MarketRequest): DexPair[] {
  const somnia = pairs.filter(isSomniaDreamPair);
  const pool = somnia.length > 0 ? somnia : pairs;
  const sorted = [...pool].sort(
    (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
  );
  const max = request.action === "orderbook" ? 2 : 8;
  return sorted.slice(0, max);
}

function buildDexscreenerSuccess(
  env: DreamdexEnv,
  request: MarketRequest,
  pairs: DexPair[],
  top: DexPair | null,
  chainWarning: string | null,
  mcpNote?: string,
): string {
  const topSummary = top ? toTopPairSummary(top) : null;
  const findings = buildFindings(request, topSummary, chainWarning);
  if (mcpNote) findings.unshift(mcpNote);

  const responsePairs = filterPairsForResponse(pairs, request).map((pair) => ({
    symbol: pair.baseToken?.symbol,
    priceUsd: pair.priceUsd,
    liquidityUsd: pair.liquidity?.usd,
    volume24h: pair.volume?.h24,
    change24h: pair.priceChange?.h24,
    dex: pair.dexId,
    chain: pair.chainId,
  }));

  const payload: Record<string, unknown> = {
    type: "dreamdex-mcp",
    agentName: env.AGENT_NAME,
    source: "dexscreener",
    action: request.action,
    pair: request.pair,
    topPair: topSummary,
    totalPairsFound: pairs.length,
    lpRiskHints: buildLpRiskHints(topSummary),
    findings,
    ts: new Date().toISOString(),
  };

  if (request.action === "orderbook") {
    payload.orderbook = buildOrderbookProxy(topSummary);
    payload.pairs = responsePairs;
  } else if (responsePairs.length > 0) {
    payload.pairs = responsePairs;
  }

  return JSON.stringify(payload);
}

async function fetchCoingeckoMetrics(coinId: string): Promise<CoingeckoCoinMetrics> {
  const url = buildCoingeckoUrl(coinId);
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  const metrics = extractCoingeckoMetrics(data, coinId);
  if (!metrics) throw new Error(`CoinGecko missing data for id=${coinId}`);
  return metrics;
}

function buildCoingeckoSuccess(
  env: DreamdexEnv,
  coinId: string,
  metrics: CoingeckoCoinMetrics,
): string {
  const findings: string[] = [];
  if (metrics.usd != null) {
    findings.push(`${coinId} ~$${metrics.usd} (CoinGecko)`);
  } else {
    findings.push(`CoinGecko returned metrics for ${coinId} without usd price`);
  }
  if (metrics.usd_24h_change != null) {
    findings.push(`24h change ${metrics.usd_24h_change.toFixed(2)}%`);
  }
  if (metrics.usd_market_cap != null) {
    findings.push(`Market cap $${formatNum(metrics.usd_market_cap)}`);
  }
  if (metrics.usd_24h_vol != null) {
    findings.push(`24h volume $${formatNum(metrics.usd_24h_vol)}`);
  }

  return JSON.stringify({
    type: "dreamdex-mcp",
    agentName: env.AGENT_NAME,
    source: "coingecko",
    action: "coingecko",
    id: coinId,
    somnia: metrics,
    findings,
    ts: new Date().toISOString(),
  });
}

async function fetchDexscreenerPairs(pairQuery: string): Promise<DexPair[]> {
  const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(pairQuery)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`DexScreener ${res.status}`);
  const data = (await res.json()) as { pairs?: DexPair[] };
  return data.pairs ?? [];
}

async function tryMcpPath(
  env: DreamdexEnv,
  request: MarketRequest,
  rawPayload: string,
): Promise<string | null> {
  if (!env.DREAMDEX_MCP_URL) return null;

  try {
    const res = await fetch(env.DREAMDEX_MCP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: request.action,
        pair: request.pair,
        raw: rawPayload,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;

    const body = await res.text();
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      return JSON.stringify({
        type: "dreamdex-mcp",
        agentName: env.AGENT_NAME,
        source: "dreamdex-mcp",
        action: request.action,
        pair: request.pair,
        topPair:
          parsed.topPair && typeof parsed.topPair === "object"
            ? parsed.topPair
            : undefined,
        lpRiskHints: Array.isArray(parsed.lpRiskHints) ? parsed.lpRiskHints : buildLpRiskHints(null),
        findings: Array.isArray(parsed.findings)
          ? parsed.findings
          : [`dreamDEX MCP response received for ${request.pair}`],
        mcpData: parsed,
        ts: new Date().toISOString(),
      });
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

export async function executeDreamdex(input: ExternalExecuteInput): Promise<string> {
  const env = input.env as DreamdexEnv;
  const parsed = parsePayload(input.payloadHex);
  const request = parseMarketRequest(parsed.json);

  if (request.action === "coingecko") {
    const coinId = parseCoingeckoId(parsed.json);
    try {
      const metrics = await fetchCoingeckoMetrics(coinId);
      return buildCoingeckoSuccess(env, coinId, metrics);
    } catch (error) {
      return structuredError(env.AGENT_NAME, "coingecko", String(error), {
        action: "coingecko",
        id: coinId,
        partial: true,
      });
    }
  }

  const mcpResult = await tryMcpPath(env, request, parsed.raw);
  if (mcpResult) return mcpResult;

  const mcpNote = env.DREAMDEX_MCP_URL
    ? "dreamDEX MCP unavailable or returned non-JSON — using DexScreener fallback"
    : undefined;

  try {
    const pairs = await fetchDexscreenerPairs(request.pair);
    const { top, chainWarning } = pickBestPair(pairs);
    return buildDexscreenerSuccess(env, request, pairs, top, chainWarning, mcpNote);
  } catch (error) {
    return structuredError(env.AGENT_NAME, "dexscreener", String(error), {
      action: request.action,
      pair: request.pair,
      partial: true,
    });
  }
}
