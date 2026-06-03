import { parseAbiItem } from "viem";
import { AgentOrchestratorAbi, StepState, TaskState } from "@twiin/shared";
import { publicClient } from "../clients";
import { addresses } from "../contracts";
import {
  getCursor,
  setCursor,
  updateTaskState,
  upsertStep,
  upsertTask,
} from "../db";
import { env } from "../env";
import { publish } from "../sse";

const CURSOR_KEY = "indexer";
const POLL_MS = 4_000;
const CHUNK = 500n;

let running = false;

export function startIndexer(): void {
  if (running) return;
  running = true;
  void poll();
}

async function poll(): Promise<void> {
  while (running) {
    try {
      await tick();
    } catch (e) {
      console.error("[indexer] error:", e);
    }
    await sleep(POLL_MS);
  }
}

async function tick(): Promise<void> {
  const latest = await publicClient.getBlockNumber();
  const stored = await getCursor(CURSOR_KEY);
  const from = stored === 0n && env.START_BLOCK > 0n ? env.START_BLOCK : stored;
  if (from > latest) return;
  const to = from + CHUNK < latest ? from + CHUNK : latest;

  // TaskCreated
  const taskCreated = await publicClient.getLogs({
    address: addresses.orchestrator,
    event: parseAbiItem(
      "event TaskCreated(uint256 indexed taskId, uint256 indexed personalAgentId, uint8 mode, uint256 budgetWei)",
    ),
    fromBlock: from,
    toBlock: to,
  });

  for (const log of taskCreated) {
    const { taskId, personalAgentId, mode, budgetWei } = log.args;
    if (taskId == null || personalAgentId == null) continue;
    await upsertTask(
      taskId.toString(),
      personalAgentId.toString(),
      mode ?? 0,
      budgetWei?.toString() ?? "0",
      TaskState.Running,
      0,
      0,
      Number(log.blockNumber ?? 0n),
    );
    publish(taskId.toString(), "task_created", {
      taskId: taskId.toString(),
      personalAgentId: personalAgentId.toString(),
      mode,
      budgetWei: budgetWei?.toString(),
    });
  }

  // ExternalAgentRequest — gives us step payload + reqId
  const extReqs = await publicClient.getLogs({
    address: addresses.orchestrator,
    event: parseAbiItem(
      "event ExternalAgentRequest(uint256 indexed taskId, uint8 stepIdx, uint256 configId, address registrant, bytes32 endpointHash, bytes payload, bytes32 reqId, uint64 deadline)",
    ),
    fromBlock: from,
    toBlock: to,
  });

  for (const log of extReqs) {
    const { taskId, stepIdx, configId, payload, reqId, deadline } = log.args;
    if (taskId == null || stepIdx == null) continue;
    const payloadText = decodePayload(payload ?? "0x");
    await upsertStep(
      taskId.toString(),
      stepIdx,
      configId?.toString() ?? "0",
      StepState.RunningExternal,
      payloadText,
      reqId ?? null,
      null,
      null,
      deadline ? Number(deadline) : null,
    );
    publish(taskId.toString(), "step_dispatched", {
      taskId: taskId.toString(),
      stepIdx,
      configId: configId?.toString(),
    });
  }

  // StepStateChanged — generic state update
  const stateChanges = await publicClient.getLogs({
    address: addresses.orchestrator,
    event: parseAbiItem(
      "event StepStateChanged(uint256 indexed taskId, uint8 stepIdx, uint8 state)",
    ),
    fromBlock: from,
    toBlock: to,
  });

  for (const log of stateChanges) {
    const { taskId, stepIdx, state } = log.args;
    if (taskId == null || stepIdx == null) continue;
    await upsertStep(
      taskId.toString(),
      stepIdx,
      "0",
      state ?? 0,
      "",
      null,
      null,
      null,
      null,
    );
    publish(taskId.toString(), "step_state", {
      taskId: taskId.toString(),
      stepIdx,
      state,
      stateName: StepState[state ?? 0] ?? "Unknown",
    });
  }

  // ExternalResultPending — result bytes landed, awaiting rating
  const resultsPending = await publicClient.getLogs({
    address: addresses.orchestrator,
    event: parseAbiItem(
      "event ExternalResultPending(uint256 indexed taskId, uint8 stepIdx, address registrant, bytes result)",
    ),
    fromBlock: from,
    toBlock: to,
  });

  for (const log of resultsPending) {
    const { taskId, stepIdx, result } = log.args;
    if (taskId == null || stepIdx == null) continue;
    await upsertStep(
      taskId.toString(),
      stepIdx,
      "0",
      StepState.AwaitingRating,
      "",
      null,
      result ?? "0x",
      null,
      null,
    );
    publish(taskId.toString(), "step_result_pending", {
      taskId: taskId.toString(),
      stepIdx,
    });
  }

  // ExternalStepApproved
  const approved = await publicClient.getLogs({
    address: addresses.orchestrator,
    event: parseAbiItem(
      "event ExternalStepApproved(uint256 indexed taskId, uint8 stepIdx, address registrant, uint8 score)",
    ),
    fromBlock: from,
    toBlock: to,
  });
  for (const log of approved) {
    const { taskId, stepIdx, score } = log.args;
    if (taskId == null || stepIdx == null) continue;
    await upsertStep(
      taskId.toString(),
      stepIdx,
      "0",
      StepState.Succeeded,
      "",
      null,
      null,
      score ?? null,
      null,
    );
    publish(taskId.toString(), "step_approved", {
      taskId: taskId.toString(),
      stepIdx,
      score,
    });
  }

  // ExternalStepRejected
  const rejected = await publicClient.getLogs({
    address: addresses.orchestrator,
    event: parseAbiItem(
      "event ExternalStepRejected(uint256 indexed taskId, uint8 stepIdx, address registrant, uint8 score)",
    ),
    fromBlock: from,
    toBlock: to,
  });
  for (const log of rejected) {
    const { taskId, stepIdx, score } = log.args;
    if (taskId == null || stepIdx == null) continue;
    await upsertStep(
      taskId.toString(),
      stepIdx,
      "0",
      StepState.Failed,
      "",
      null,
      null,
      score ?? null,
      null,
    );
    publish(taskId.toString(), "step_rejected", {
      taskId: taskId.toString(),
      stepIdx,
      score,
    });
  }

  // TaskCompleted
  const completed = await publicClient.getLogs({
    address: addresses.orchestrator,
    event: parseAbiItem(
      "event TaskCompleted(uint256 indexed taskId, string result)",
    ),
    fromBlock: from,
    toBlock: to,
  });
  for (const log of completed) {
    const { taskId, result } = log.args;
    if (taskId == null) continue;
    await updateTaskState(taskId.toString(), TaskState.Completed);
    publish(taskId.toString(), "task_completed", {
      taskId: taskId.toString(),
      result,
    });
  }

  // TaskAborted
  const aborted = await publicClient.getLogs({
    address: addresses.orchestrator,
    event: parseAbiItem(
      "event TaskAborted(uint256 indexed taskId, string reason)",
    ),
    fromBlock: from,
    toBlock: to,
  });
  for (const log of aborted) {
    const { taskId, reason } = log.args;
    if (taskId == null) continue;
    await updateTaskState(taskId.toString(), TaskState.Aborted);
    publish(taskId.toString(), "task_aborted", {
      taskId: taskId.toString(),
      reason,
    });
  }

  await setCursor(CURSOR_KEY, to + 1n);
}

function decodePayload(hex: `0x${string}`): string {
  try {
    const bytes = Buffer.from(hex.slice(2), "hex");
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return decoded;
  } catch {
    // Non-UTF-8 binary payload — store empty string so Claude doesn't
    // receive a raw hex blob as an instruction
    return "";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
