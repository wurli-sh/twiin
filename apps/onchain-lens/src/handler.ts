import {
  parsePayload,
  structuredError,
  type ExternalExecuteInput,
} from "@twiin/external-kit";
import type { OnchainLensEnv } from "./env";

const DEFAULT_RPC = "https://dream-rpc.somnia.network";
const MAX_BLOCK_WINDOW = 50;
const DEFAULT_BLOCK_WINDOW = 20;
const MAX_LARGE_TRANSFERS = 20;
const STT_DECIMALS = 10n ** 18n;
const TRANSFER_SCAN_NOTE = "native STT tx.value only; ERC-20 not scanned";
/** Somnia testnet ~1s blocks for lookbackHours conversion */
const ESTIMATED_BLOCK_SECONDS = 1;

type BlockSample = {
  number: number;
  txCount: number;
  gasUsed: string;
  timestamp: number;
  transactions?: RpcTransaction[];
};

type RpcTransaction = {
  hash?: string;
  from?: string;
  to?: string;
  value?: string;
};

export type LargeTransfer = {
  blockNumber: number;
  hash: string;
  from: string;
  to: string;
  valueStt: number;
};

export function resolveBlockWindow(
  json: Record<string, unknown> | null | undefined,
): number {
  if (typeof json?.blockWindow === "number" && json.blockWindow > 0) {
    return Math.min(Math.floor(json.blockWindow), MAX_BLOCK_WINDOW);
  }
  if (typeof json?.lookbackHours === "number" && json.lookbackHours > 0) {
    const estimated = Math.ceil((json.lookbackHours * 3600) / ESTIMATED_BLOCK_SECONDS);
    return Math.min(Math.max(estimated, 1), MAX_BLOCK_WINDOW);
  }
  return DEFAULT_BLOCK_WINDOW;
}

export function minTransferSttToWei(minTransferStt: number): bigint {
  return BigInt(Math.floor(minTransferStt)) * STT_DECIMALS;
}

export function extractLargeTransfers(
  blocks: BlockSample[],
  minTransferWei: bigint,
  maxResults = MAX_LARGE_TRANSFERS,
): { count: number; transfers: LargeTransfer[] } {
  const matches: Array<LargeTransfer & { valueWei: bigint }> = [];

  for (const block of blocks) {
    for (const tx of block.transactions ?? []) {
      if (!tx.hash || !tx.from || !tx.to || !tx.value) continue;
      const valueWei = BigInt(tx.value);
      if (valueWei < minTransferWei) continue;
      matches.push({
        blockNumber: block.number,
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        valueStt: Number(valueWei) / Number(STT_DECIMALS),
        valueWei,
      });
    }
  }

  const sorted = matches.sort((a, b) =>
    a.valueWei > b.valueWei ? -1 : a.valueWei < b.valueWei ? 1 : 0,
  );
  return {
    count: sorted.length,
    transfers: sorted
      .slice(0, maxResults)
      .map(({ valueWei: _valueWei, ...transfer }) => transfer),
  };
}

async function fetchBlockSummaries(
  rpc: string,
  latest: number,
  blockWindow: number,
  fullTxs: boolean,
): Promise<BlockSample[]> {
  const samples: BlockSample[] = [];

  for (let i = 0; i < blockWindow; i++) {
    const blockNum = latest - i;
    if (blockNum < 0) break;
    const block = (await rpcCall(rpc, "eth_getBlockByNumber", [
      `0x${blockNum.toString(16)}`,
      fullTxs,
    ])) as {
      number?: string;
      transactions?: unknown[];
      gasUsed?: string;
      timestamp?: string;
    } | null;
    if (!block) continue;
    samples.push({
      number: blockNum,
      txCount: block.transactions?.length ?? 0,
      gasUsed: block.gasUsed ?? "0x0",
      timestamp: block.timestamp ? Number.parseInt(block.timestamp, 16) : 0,
      transactions: fullTxs ? (block.transactions as RpcTransaction[] | undefined) : undefined,
    });
  }

  return samples;
}

function buildFindings(params: {
  latest: number;
  samples: BlockSample[];
  avgTx: number;
  gasTotal: number;
  lookbackHours?: number;
  minTransferStt?: number;
  largeTransferCount?: number;
  largeTransfers?: LargeTransfer[];
}): string[] {
  const findings = [
    `Latest block #${params.latest} on Somnia testnet`,
    `Block window: last ${params.samples.length} blocks`,
    `Avg ${params.avgTx.toFixed(1)} txs/block over last ${params.samples.length} blocks`,
    `Sampled gas used ${params.gasTotal.toLocaleString()}`,
  ];

  if (typeof params.lookbackHours === "number") {
    findings.push(
      `Requested lookbackHours=${params.lookbackHours} mapped to ${params.samples.length} blocks (cap ${MAX_BLOCK_WINDOW})`,
    );
  }

  if (params.minTransferStt !== undefined && params.largeTransferCount !== undefined) {
    const count = params.largeTransferCount;
    findings.push(`Large native transfers >= ${params.minTransferStt} STT: ${count}`);
    if (count > 0 && params.largeTransfers && params.largeTransfers.length > 0) {
      const top = params.largeTransfers[0];
      findings.push(
        `Largest transfer: ${top.valueStt.toLocaleString()} STT in block #${top.blockNumber}`,
      );
    } else {
      findings.push(
        `No native transfers >= ${params.minTransferStt} STT in sampled window (valid quiet-network result)`,
      );
    }
    findings.push(TRANSFER_SCAN_NOTE);
  }

  return findings;
}

export async function executeOnchainLens(input: ExternalExecuteInput): Promise<string> {
  const env = input.env as OnchainLensEnv;
  const parsed = parsePayload(input.payloadHex);
  const rpc = env.SOMNIA_RPC_URL ?? DEFAULT_RPC;
  const blockWindow = resolveBlockWindow(parsed.json);
  const minTransferStt =
    typeof parsed.json?.minTransferStt === "number" ? parsed.json.minTransferStt : undefined;
  const scanTransfers = minTransferStt !== undefined;

  try {
    const latestHex = (await rpcCall(rpc, "eth_blockNumber", [])) as string;
    const latest = Number.parseInt(latestHex, 16);
    const samples = await fetchBlockSummaries(rpc, latest, blockWindow, scanTransfers);

    const txTotal = samples.reduce((sum, row) => sum + row.txCount, 0);
    const avgTx = samples.length ? txTotal / samples.length : 0;
    const gasTotal = samples.reduce((sum, row) => sum + Number.parseInt(row.gasUsed, 16), 0);

    const minTransferWei =
      minTransferStt !== undefined ? minTransferSttToWei(minTransferStt) : undefined;
    const transferScan =
      minTransferWei !== undefined
        ? extractLargeTransfers(samples, minTransferWei)
        : undefined;
    const largeTransfers = transferScan?.transfers;

    const lookbackHours =
      typeof parsed.json?.lookbackHours === "number" ? parsed.json.lookbackHours : undefined;

    const findings = buildFindings({
      latest,
      samples,
      avgTx,
      gasTotal,
      lookbackHours,
      minTransferStt,
      largeTransferCount: transferScan?.count,
      largeTransfers,
    });

    const summary =
      minTransferStt !== undefined && transferScan !== undefined
        ? `Sampled ${samples.length} blocks; found ${transferScan.count} native transfers >= ${minTransferStt} STT`
        : `Sampled ${samples.length} blocks with ${txTotal} transactions`;

    return JSON.stringify({
      type: "onchain-lens",
      agentName: env.AGENT_NAME,
      source: "somnia-rpc",
      rpc,
      latestBlock: latest,
      blockWindow: samples.length,
      requestedBlockWindow: blockWindow,
      lookbackHours: parsed.json?.lookbackHours,
      minTransferStt,
      minTransferWei: minTransferWei?.toString(),
      largeTransferCount: transferScan?.count,
      largeTransfers,
      transferScanNote: scanTransfers ? TRANSFER_SCAN_NOTE : undefined,
      summary,
      avgTxPerBlock: Number(avgTx.toFixed(2)),
      totalTxSampled: txTotal,
      totalGasUsedSampled: gasTotal,
      samples: samples.slice(0, 10).map(({ transactions: _txs, ...sample }) => sample),
      findings,
      ts: new Date().toISOString(),
    });
  } catch (error) {
    return structuredError(env.AGENT_NAME, "somnia-rpc", String(error), {
      rpc,
      partial: true,
    });
  }
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
