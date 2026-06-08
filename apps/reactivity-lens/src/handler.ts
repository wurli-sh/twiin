import {
  parsePayload,
  structuredError,
  type ExternalExecuteInput,
} from "@twiin/external-kit";
import addressesRaw from "@twiin/shared/addresses.json";
import { OracleFeedAbi, loadAddresses } from "@twiin/shared";
import {
  decodeFunctionResult,
  encodeFunctionData,
  parseAbiItem,
  toEventSelector,
  type Hex,
} from "viem";
import type { ReactivityLensEnv } from "./env";

const DEFAULT_RPC = "https://dream-rpc.somnia.network";
/** Somnia RPC rejects eth_getLogs ranges wider than 1000 blocks */
export const MAX_RPC_BLOCK_RANGE = 1000;
const DEFAULT_LOOKBACK_BLOCKS = MAX_RPC_BLOCK_RANGE;

const FEED_PUBLISHED_TOPIC = toEventSelector(
  parseAbiItem(
    "event FeedPublished(uint256 indexed agentId, string topic, string value, uint8 confidence, uint256 timestamp)",
  ),
);
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

type RpcLog = {
  blockNumber?: Hex;
  topics?: Hex[];
  data?: Hex;
};

type FeedSample = {
  agentId: number;
  topic: string;
  stale: boolean;
  confidence: number;
  value?: string;
};

export function parseReactivityPayload(json: Record<string, unknown> | null): {
  agentId?: number;
  topic?: string;
  lookbackBlocks: number;
} {
  const agentId =
    typeof json?.agentId === "number" && Number.isFinite(json.agentId)
      ? json.agentId
      : undefined;
  const topic = typeof json?.topic === "string" ? json.topic : undefined;
  const raw =
    typeof json?.lookbackBlocks === "number" && json.lookbackBlocks > 0
      ? Math.floor(json.lookbackBlocks)
      : DEFAULT_LOOKBACK_BLOCKS;
  const lookbackBlocks = Math.min(raw, MAX_RPC_BLOCK_RANGE);
  return { agentId, topic, lookbackBlocks };
}

export async function executeReactivityLens(
  input: ExternalExecuteInput,
): Promise<string> {
  const env = input.env as ReactivityLensEnv;
  const parsed = parsePayload(input.payloadHex);
  const rpc = env.SOMNIA_RPC_URL ?? DEFAULT_RPC;
  const { agentId, topic, lookbackBlocks } = parseReactivityPayload(
    parsed.json as Record<string, unknown> | null,
  );

  try {
    const addresses = loadAddresses(addressesRaw);
    const latestHex = (await rpcCall(rpc, "eth_blockNumber", [])) as Hex;
    const latest = BigInt(latestHex);
    const fromBlock =
      latest > BigInt(lookbackBlocks) ? latest - BigInt(lookbackBlocks) : 0n;

    const feedsSampled: FeedSample[] = [];
    if (agentId != null && topic) {
      const feed = await readGetFeed(rpc, addresses.oracleFeed, agentId, topic);
      const stale = await readIsStale(rpc, addresses.oracleFeed, agentId, topic);
      feedsSampled.push({
        agentId,
        topic,
        stale,
        confidence: feed.confidence,
        value: feed.value.slice(0, 200),
      });
    }

    const [feedLogs, scheduledLogs, skippedLogs] = await Promise.all([
      getLogsInRange(rpc, addresses.oracleFeed, [FEED_PUBLISHED_TOPIC], fromBlock, latest),
      getLogsInRange(rpc, addresses.refreshManager, [REFRESH_SCHEDULED_TOPIC], fromBlock, latest),
      getLogsInRange(rpc, addresses.refreshManager, [REFRESH_SKIPPED_TOPIC], fromBlock, latest),
    ]);

    const recentScheduled = scheduledLogs.slice(-5).map((log) => ({
      blockNumber: log.blockNumber,
      agentId: log.topics?.[1] ? Number(BigInt(log.topics[1])) : null,
    }));
    const recentSkipped = skippedLogs.slice(-5).map((log) => ({
      blockNumber: log.blockNumber,
      agentId: log.topics?.[1] ? Number(BigInt(log.topics[1])) : null,
    }));

    const uniqueFeedAgents = new Set(
      feedLogs
        .map((log) => (log.topics?.[1] ? Number(BigInt(log.topics[1])) : null))
        .filter((id): id is number => id != null),
    );

    const blocksScanned = Number(latest - fromBlock + 1n);
    const summary =
      `Scanned blocks ${fromBlock}–${latest} (${blocksScanned} blocks). ` +
      `Found ${feedLogs.length} FeedPublished, ${scheduledLogs.length} RefreshScheduled, ${skippedLogs.length} RefreshSkipped.`;

    const findings = [
      `Block window: #${fromBlock}–#${latest} (${blocksScanned} blocks scanned via eth_getLogs)`,
      `Events: ${feedLogs.length} FeedPublished, ${scheduledLogs.length} RefreshScheduled, ${skippedLogs.length} RefreshSkipped`,
      feedsSampled.length
        ? `Feed ${feedsSampled[0].topic} stale=${feedsSampled[0].stale}`
        : `Unique agents with feed publishes: ${uniqueFeedAgents.size} (quiet window is valid)`,
    ];

    return JSON.stringify({
      type: "reactivity-lens",
      agentName: env.AGENT_NAME,
      source: "somnia-reactivity",
      rpc,
      lookbackBlocks,
      fromBlock: fromBlock.toString(),
      latestBlock: latest.toString(),
      blocksScanned,
      summary,
      oracleFeed: addresses.oracleFeed,
      refreshManager: addresses.refreshManager,
      feedsSampled,
      refreshEvents: {
        feedPublished: feedLogs.length,
        scheduled: scheduledLogs.length,
        skipped: skippedLogs.length,
        uniqueFeedAgents: uniqueFeedAgents.size,
        recentScheduled,
        recentSkipped,
      },
      findings,
      ts: new Date().toISOString(),
    });
  } catch (error) {
    return structuredError(env.AGENT_NAME, "somnia-reactivity", String(error), {
      rpc,
      lookbackBlocks,
      partial: true,
    });
  }
}

async function readGetFeed(
  rpc: string,
  contract: `0x${string}`,
  agentId: number,
  topic: string,
): Promise<{ value: string; confidence: number; timestamp: bigint; stale: boolean }> {
  const data = encodeFunctionData({
    abi: OracleFeedAbi,
    functionName: "getFeed",
    args: [BigInt(agentId), topic],
  });
  const result = (await rpcCall(rpc, "eth_call", [
    { to: contract, data },
    "latest",
  ])) as Hex;
  const decoded = decodeFunctionResult({
    abi: OracleFeedAbi,
    functionName: "getFeed",
    data: result,
  }) as [string, number, bigint, boolean];
  return {
    value: decoded[0],
    confidence: decoded[1],
    timestamp: decoded[2],
    stale: decoded[3],
  };
}

async function readIsStale(
  rpc: string,
  contract: `0x${string}`,
  agentId: number,
  topic: string,
): Promise<boolean> {
  const data = encodeFunctionData({
    abi: OracleFeedAbi,
    functionName: "isStale",
    args: [BigInt(agentId), topic],
  });
  const result = (await rpcCall(rpc, "eth_call", [
    { to: contract, data },
    "latest",
  ])) as Hex;
  return decodeFunctionResult({
    abi: OracleFeedAbi,
    functionName: "isStale",
    data: result,
  }) as boolean;
}

async function getLogsInRange(
  rpc: string,
  address: `0x${string}`,
  topics: Hex[],
  fromBlock: bigint,
  toBlock: bigint,
): Promise<RpcLog[]> {
  const chunkSize = BigInt(MAX_RPC_BLOCK_RANGE);
  const all: RpcLog[] = [];
  let start = fromBlock;
  while (start <= toBlock) {
    const end = start + chunkSize - 1n > toBlock ? toBlock : start + chunkSize - 1n;
    const result = (await rpcCall(rpc, "eth_getLogs", [
      {
        address,
        topics,
        fromBlock: `0x${start.toString(16)}`,
        toBlock: `0x${end.toString(16)}`,
      },
    ])) as RpcLog[];
    if (Array.isArray(result)) all.push(...result);
    start = end + 1n;
  }
  return all;
}

async function rpcCall(rpc: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const body = (await res.json()) as { error?: { message?: string }; result?: unknown };
  if (body.error) throw new Error(body.error.message ?? "RPC error");
  return body.result;
}
