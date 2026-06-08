import { MAX_PRIOR_CONTEXT_CHARS } from "@twiin/shared";

const RATING_RESULT_MAX_CHARS = MAX_PRIOR_CONTEXT_CHARS;

export function prepareResultForRating(resultText: string): string {
  try {
    const parsed = JSON.parse(resultText) as Record<string, unknown>;
    const parts: string[] = [];

    if (typeof parsed.type === "string") parts.push(`type: ${parsed.type}`);
    if (typeof parsed.source === "string") parts.push(`source: ${parsed.source}`);
    if (typeof parsed.ok === "boolean") parts.push(`ok: ${parsed.ok}`);
    if (typeof parsed.status === "number") parts.push(`status: ${parsed.status}`);
    if (typeof parsed.question === "string") parts.push(`question: ${parsed.question}`);
    if (typeof parsed.answered === "boolean") parts.push(`answered: ${parsed.answered}`);
    if (typeof parsed.summary === "string") parts.push(`summary:\n${parsed.summary}`);
    if (typeof parsed.lookbackBlocks === "number") {
      parts.push(`lookbackBlocks: ${parsed.lookbackBlocks}`);
    }
    if (typeof parsed.fromBlock === "string") parts.push(`fromBlock: ${parsed.fromBlock}`);
    if (typeof parsed.latestBlock === "string") parts.push(`latestBlock: ${parsed.latestBlock}`);
    if (typeof parsed.blocksScanned === "number") {
      parts.push(`blocksScanned: ${parsed.blocksScanned}`);
    }
    if (typeof parsed.blockWindow === "number") {
      parts.push(`blockWindow: ${parsed.blockWindow}`);
    }
    if (typeof parsed.latestBlock === "number") {
      parts.push(`latestBlock: ${parsed.latestBlock}`);
    }
    if (typeof parsed.totalTxSampled === "number") {
      parts.push(`totalTxSampled: ${parsed.totalTxSampled}`);
    }
    if (typeof parsed.minTransferStt === "number") {
      parts.push(`minTransferStt: ${parsed.minTransferStt}`);
    }
    if (typeof parsed.largeTransferCount === "number") {
      parts.push(`largeTransferCount: ${parsed.largeTransferCount}`);
    }
    if (Array.isArray(parsed.largeTransfers)) {
      parts.push(`largeTransfers: ${JSON.stringify(parsed.largeTransfers.slice(0, 5))}`);
    }
    if (typeof parsed.transferScanNote === "string") {
      parts.push(`transferScanNote: ${parsed.transferScanNote}`);
    }
    if (parsed.refreshEvents && typeof parsed.refreshEvents === "object") {
      parts.push(`refreshEvents: ${JSON.stringify(parsed.refreshEvents)}`);
    }
    if (Array.isArray(parsed.findings)) {
      parts.push(`findings:\n${parsed.findings.map((f) => `- ${String(f)}`).join("\n")}`);
    }
    if (parsed.topPair && typeof parsed.topPair === "object") {
      parts.push(`topPair: ${JSON.stringify(parsed.topPair)}`);
    }
    if (parsed.orderbook && typeof parsed.orderbook === "object") {
      parts.push(`orderbook: ${JSON.stringify(parsed.orderbook)}`);
    }
    if (Array.isArray(parsed.lpRiskHints)) {
      parts.push(`lpRiskHints: ${JSON.stringify(parsed.lpRiskHints)}`);
    }
    if (parsed.somnia && typeof parsed.somnia === "object") {
      parts.push(`somnia: ${JSON.stringify(parsed.somnia)}`);
    }
    if (typeof parsed.id === "string") parts.push(`id: ${parsed.id}`);
    if (typeof parsed.excerpt === "string") {
      parts.push(`excerpt: ${parsed.excerpt.slice(0, 1500)}`);
    }
    if (parsed.type === "external-error" && typeof parsed.error === "string") {
      parts.push(`error: ${parsed.error}`);
    }

    if (parts.length > 0) {
      return parts.join("\n").slice(0, RATING_RESULT_MAX_CHARS);
    }
  } catch {
    // fall through to raw text
  }
  return resultText.slice(0, RATING_RESULT_MAX_CHARS);
}

export function buildAgentRatingHints(resultText: string): string {
  try {
    const parsed = JSON.parse(resultText) as Record<string, unknown>;
    if (parsed.type === "dreamdex-mcp" && parsed.source === "dexscreener") {
      return `\nRATING GUIDANCE: DexScreener proxy snapshot, not a native L2 orderbook. Score on topPair, orderbook proxy fields, lpRiskHints, and findings. Do not penalize missing literal bids/asks when proxy metadata is present.`;
    }
    if (parsed.type === "dreamdex-mcp" && parsed.source === "coingecko") {
      return `\nRATING GUIDANCE: External CoinGecko corroboration step. Score on somnia.usd and other numeric fields in somnia, plus findings. Compare mentally to prior dreamdex DexScreener price if present in context — material disagreement is acceptable to note but do not fail solely on small float drift.`;
    }
    if (parsed.type === "docs-lens") {
      return `\nRATING GUIDANCE: docs-lens fetches official Somnia documentation. Score on ok/status, summary, findings, and whether excerpt addresses the question. Raw markdown is acceptable if relevant.`;
    }
    if (parsed.type === "reactivity-lens") {
      return `\nRATING GUIDANCE: reactivity-lens scans OracleFeed and refresh events over a block window via eth_getLogs. Score on whether fromBlock/latestBlock/blocksScanned prove the requested window was scanned and event counts are reported honestly. Zero events in a valid window is acceptable on a quiet testnet — do not fail solely because counts are 0. Fail only on external-error, missing block range, or RPC failure.`;
    }
    if (parsed.type === "onchain-lens") {
      return `\nRATING GUIDANCE: onchain-lens samples recent blocks via eth_getBlockByNumber. When minTransferStt is in the instruction, score on whether blocks were sampled and large native STT transfers were scanned (largeTransferCount/largeTransfers). Zero matching transfers in a valid window is acceptable. Do not fail because ERC-20 transfers are not scanned. Fail on external-error or missing block/transfer scan metadata when minTransferStt was requested.`;
    }
  } catch {
    // ignore
  }
  return "";
}

const AGENT_SCORE_FLOOR = 45;
const REACTIVITY_LOOKBACK_TOLERANCE = 1;

function parseBlockNumber(value: unknown): bigint | null {
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return BigInt(Math.floor(value));
  }
  return null;
}

function deriveBlocksScanned(parsed: Record<string, unknown>): number | null {
  if (typeof parsed.blocksScanned === "number" && parsed.blocksScanned >= 1) {
    return Math.floor(parsed.blocksScanned);
  }
  const from = parseBlockNumber(parsed.fromBlock);
  const latest = parseBlockNumber(parsed.latestBlock);
  if (from == null || latest == null || latest < from) return null;
  const scanned = Number(latest - from + 1n);
  return scanned >= 1 ? scanned : null;
}

function getReactivityLensScoreFloor(parsed: Record<string, unknown>): number | null {
  const lookbackBlocks =
    typeof parsed.lookbackBlocks === "number" && parsed.lookbackBlocks > 0
      ? Math.floor(parsed.lookbackBlocks)
      : null;
  if (lookbackBlocks == null) return null;

  const blocksScanned = deriveBlocksScanned(parsed);
  if (blocksScanned == null) return null;
  if (blocksScanned > lookbackBlocks + REACTIVITY_LOOKBACK_TOLERANCE) return null;

  return AGENT_SCORE_FLOOR;
}

function getOnchainLensScoreFloor(parsed: Record<string, unknown>): number | null {
  const blockWindow =
    typeof parsed.blockWindow === "number" && parsed.blockWindow >= 1
      ? Math.floor(parsed.blockWindow)
      : null;
  const latestBlock =
    typeof parsed.latestBlock === "number" && parsed.latestBlock > 0
      ? Math.floor(parsed.latestBlock)
      : null;
  if (blockWindow == null || latestBlock == null) return null;

  if (typeof parsed.minTransferStt === "number") {
    if (typeof parsed.largeTransferCount !== "number") return null;
    return AGENT_SCORE_FLOOR;
  }

  if (typeof parsed.totalTxSampled !== "number") return null;
  return AGENT_SCORE_FLOOR;
}

export function getDeterministicScoreFloor(resultText: string): number | null {
  try {
    const parsed = JSON.parse(resultText) as Record<string, unknown>;
    if (parsed.type === "reactivity-lens") {
      return getReactivityLensScoreFloor(parsed);
    }
    if (parsed.type === "onchain-lens") {
      return getOnchainLensScoreFloor(parsed);
    }
    return null;
  } catch {
    return null;
  }
}

export function buildRatingPrompt(
  instruction: string,
  resultForRating: string,
  agentHints: string,
): string {
  return `Rate the quality of this AI agent's work on a scale of 0-100.
A score >= 40 means the result is acceptable and payment will be released.${agentHints}

INSTRUCTION: ${instruction.slice(0, 800)}

RESULT: ${resultForRating}

Respond with ONLY a JSON object: {"score": <number 0-100>, "reason": "<one sentence>"}`;
}
