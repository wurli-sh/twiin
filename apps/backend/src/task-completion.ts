import { decodeTaskCompletionFromLogData } from "@twiin/shared";
import { type AbiEvent, type Hex, type PublicClient, parseAbiItem } from "viem";

const taskCompletedEvent = parseAbiItem(
  "event TaskCompleted(uint256 indexed taskId, string result)",
) as AbiEvent;

const LOG_CHUNK = 999n;

export type TaskCompletion = {
  result: string;
  decoded: string | null;
  blockNumber: string;
  transactionHash: string;
};

export async function fetchTaskCompletion(
  client: PublicClient,
  orchestrator: `0x${string}`,
  taskId: bigint,
  fromBlock: bigint,
): Promise<TaskCompletion | null> {
  const latest = await client.getBlockNumber();
  for (let from = fromBlock; from <= latest; from += LOG_CHUNK + 1n) {
    const to = from + LOG_CHUNK > latest ? latest : from + LOG_CHUNK;
    const logs = await client.getLogs({
      address: orchestrator,
      event: taskCompletedEvent,
      args: { taskId },
      fromBlock: from,
      toBlock: to,
    });

    let fallback: TaskCompletion | null = null;
    for (const log of logs) {
      if (!log?.data) continue;
      const args = (log.args ?? {}) as { result?: string };

      const entry: TaskCompletion = {
        result: args.result ?? "",
        decoded: decodeTaskCompletionFromLogData(log.data as Hex),
        blockNumber: (log.blockNumber ?? 0n).toString(),
        transactionHash: log.transactionHash ?? "",
      };

      if (entry.decoded) return entry;
      fallback = entry;
    }

    if (fallback) return fallback;
  }
  return null;
}
