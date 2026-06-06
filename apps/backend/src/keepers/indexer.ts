import { decodeFunctionData, parseAbiItem, type AbiEvent, type Hex } from "viem";
import { decodeTaskCompletionFromLogData, StepState, TaskState } from "@twiin/shared";
import AgentOrchestratorAbi from "@twiin/shared/abis/AgentOrchestrator.json";
import TwiinAccountAbi from "@twiin/shared/abis/TwiinAccount.json";
import { publicClient } from "../clients";
import { addresses, defaultStartBlock } from "../contracts";
import {
  deactivateExternalAgent,
  deleteStepsForTask,
  finalizeTaskSteps,
  getExternalAgent,
  getCursor,
  getStep,
  setCursor,
  updateTaskState,
  upsertExternalAgent,
  upsertStep,
  upsertTask,
} from "../db";
import { env } from "../env";
import { publish } from "../sse";
import { logTaskTimeline } from "../task-log";

const CURSOR_KEY = "indexer";
const POLL_MS = 4_000;
const CHUNK = 500n;
const MAX_RPC_LOG_RANGE = 1_000n;
const FAST_FORWARD_LAG_THRESHOLD = 100_000n;
const FAST_FORWARD_TAIL = 10_000n;
const INDEXER_TICK_LOG_LAG_THRESHOLD = 5_000n;

const taskCreatedEvent = parseAbiItem(
  "event TaskCreated(uint256 indexed taskId, uint256 indexed personalAgentId, uint8 mode, uint256 budgetWei)",
) as AbiEvent;
const externalAgentRequestEvent = parseAbiItem(
  "event ExternalAgentRequest(uint256 indexed taskId, uint8 stepIdx, uint256 configId, address registrant, bytes32 endpointHash, bytes payload, bytes32 reqId, uint64 deadline)",
) as AbiEvent;
const stepStateChangedEvent = parseAbiItem(
  "event StepStateChanged(uint256 indexed taskId, uint8 stepIdx, uint8 state)",
) as AbiEvent;
const externalResultPendingEvent = parseAbiItem(
  "event ExternalResultPending(uint256 indexed taskId, uint8 stepIdx, address registrant, bytes result)",
) as AbiEvent;
const externalStepApprovedEvent = parseAbiItem(
  "event ExternalStepApproved(uint256 indexed taskId, uint8 stepIdx, address registrant, uint8 score)",
) as AbiEvent;
const externalStepRejectedEvent = parseAbiItem(
  "event ExternalStepRejected(uint256 indexed taskId, uint8 stepIdx, address registrant, uint8 score)",
) as AbiEvent;
const taskCompletedEvent = parseAbiItem(
  "event TaskCompleted(uint256 indexed taskId, string result)",
) as AbiEvent;
const taskAbortedEvent = parseAbiItem(
  "event TaskAborted(uint256 indexed taskId, string reason)",
) as AbiEvent;
const externalAgentRegisteredEvent = parseAbiItem(
  "event ExternalAgentRegistered(uint256 indexed configId, address indexed registrant, string endpointUrl, bytes32 endpointHash, bytes32[] caps, uint256 costWei)",
) as AbiEvent;
const externalEndpointUpdatedEvent = parseAbiItem(
  "event ExternalEndpointUpdated(uint256 indexed configId, string newUrl, bytes32 newHash)",
) as AbiEvent;
const externalDeregisteredEvent = parseAbiItem(
  "event ExternalDeregistered(uint256 indexed configId, address indexed registrant)",
) as AbiEvent;

type LogArgs = Record<
  string,
  bigint | number | string | `0x${string}` | `0x${string}`[] | null | undefined
>;

type TxLike = {
  input: Hex;
};

type DecodedTaskStep = {
  configId: string;
  payload: string;
  timeoutSeconds: number;
};

type IndexerDeps = {
  getBlockNumber: () => Promise<bigint>;
  getBlockTimestamp: (blockNumber: bigint) => Promise<number>;
  getLogs: (args: {
    address: `0x${string}`;
    event: AbiEvent;
    fromBlock: bigint;
    toBlock: bigint;
  }) => Promise<
    Array<{
      args: LogArgs;
      data?: Hex | null;
      blockNumber?: bigint | null;
      transactionHash?: `0x${string}` | null;
    }>
  >;
  getTransaction: (hash: `0x${string}`) => Promise<TxLike>;
  addresses: { orchestrator: `0x${string}`; agentRegistry: `0x${string}` };
  startBlock: bigint;
  getCursor: (name: string) => Promise<bigint>;
  setCursor: (name: string, block: bigint) => Promise<void>;
  getExternalAgent: typeof getExternalAgent;
  getStep: typeof getStep;
  upsertExternalAgent: typeof upsertExternalAgent;
  deactivateExternalAgent: typeof deactivateExternalAgent;
  upsertTask: typeof upsertTask;
  deleteStepsForTask: typeof deleteStepsForTask;
  finalizeTaskSteps: typeof finalizeTaskSteps;
  upsertStep: typeof upsertStep;
  updateTaskState: typeof updateTaskState;
  publish: typeof publish;
};

export function createIndexer(overrides: Partial<IndexerDeps> = {}) {
  const deps: IndexerDeps = {
    getBlockNumber: () => publicClient.getBlockNumber(),
    getBlockTimestamp: async (blockNumber) =>
      Number((await publicClient.getBlock({ blockNumber })).timestamp),
    getLogs: (args) =>
      publicClient.getLogs(args) as Promise<
        Array<{
          args: LogArgs;
          blockNumber?: bigint | null;
          transactionHash?: `0x${string}` | null;
        }>
      >,
    getTransaction: (hash) => publicClient.getTransaction({ hash }),
    addresses: {
      orchestrator: addresses.orchestrator,
      agentRegistry: addresses.agentRegistry,
    },
    startBlock: env.START_BLOCK ?? defaultStartBlock,
    getCursor,
    setCursor,
    getExternalAgent,
    getStep,
    upsertExternalAgent,
    deactivateExternalAgent,
    upsertTask,
    deleteStepsForTask,
    finalizeTaskSteps,
    upsertStep,
    updateTaskState,
    publish,
    ...overrides,
  };

  let running = false;

  async function tick(): Promise<void> {
    const latest = await deps.getBlockNumber();
    const stored = await deps.getCursor(CURSOR_KEY);
    if (stored > latest) {
      const rewindTo = deps.startBlock > 0n && deps.startBlock <= latest
        ? deps.startBlock
        : latest;
      console.warn(
        `[indexer] cursor ${stored} is ahead of latest block ${latest}; rewinding to ${rewindTo}`,
      );
      await deps.setCursor(CURSOR_KEY, rewindTo);
      return;
    }
    const from = stored === 0n && deps.startBlock > 0n ? deps.startBlock : stored;
    if (from > latest) return;
    const lag = latest - from;
    if (lag > FAST_FORWARD_LAG_THRESHOLD) {
      const fastForwardTo =
        latest > FAST_FORWARD_TAIL ? latest - FAST_FORWARD_TAIL : 0n;
      if (fastForwardTo > from) {
        console.warn(
          `[indexer] lag ${lag} blocks is too large; fast-forwarding cursor from ${from} to ${fastForwardTo}`,
        );
        await deps.setCursor(CURSOR_KEY, fastForwardTo);
        return;
      }
    }
    const chunk = lag > MAX_RPC_LOG_RANGE ? MAX_RPC_LOG_RANGE : CHUNK;
    const to = from + chunk < latest ? from + chunk : latest;

    if (lag > INDEXER_TICK_LOG_LAG_THRESHOLD) {
      logTaskTimeline("indexer_tick", {
        cursor: stored.toString(),
        fromBlock: from.toString(),
        toBlock: to.toString(),
        latestBlock: latest.toString(),
        lag: lag.toString(),
        chunkSize: chunk.toString(),
        orchestrator: deps.addresses.orchestrator,
        agentRegistry: deps.addresses.agentRegistry,
      });
    }

    const load = (event: AbiEvent) =>
      deps.getLogs({
        address: deps.addresses.orchestrator,
        event,
        fromBlock: from,
        toBlock: to,
      });

    const taskCreatedLogs = await load(taskCreatedEvent);
    logIndexerLogs("TaskCreated", taskCreatedLogs.length, from, to);
    for (const log of taskCreatedLogs) {
      const { taskId, personalAgentId, mode, budgetWei } = log.args;
      if (taskId == null || personalAgentId == null) continue;
      await deps.deleteStepsForTask(taskId.toString());
      await deps.upsertTask(
        taskId.toString(),
        personalAgentId.toString(),
        Number(mode ?? 0),
        budgetWei?.toString() ?? "0",
        TaskState.Running,
        0,
        0,
        Number(log.blockNumber ?? 0n),
      );
      const seededSteps = await loadTaskStepsFromTransaction(
        deps,
        log.transactionHash ?? null,
      );
      for (let stepIdx = 0; stepIdx < seededSteps.length; stepIdx++) {
        const seeded = seededSteps[stepIdx];
        await deps.upsertStep(
          taskId.toString(),
          stepIdx,
          seeded.configId,
          seeded.timeoutSeconds,
          StepState.Pending,
          seeded.payload,
          null,
          null,
          null,
          null,
        );
      }
      deps.publish(taskId.toString(), "task_created", {
        taskId: taskId.toString(),
        personalAgentId: personalAgentId.toString(),
        mode,
        budgetWei: budgetWei?.toString(),
      });
    }

    const externalAgentRequestLogs = await load(externalAgentRequestEvent);
    logIndexerLogs("ExternalAgentRequest", externalAgentRequestLogs.length, from, to);
    for (const log of externalAgentRequestLogs) {
      const { taskId, stepIdx, configId, payload, reqId, deadline } = log.args;
      if (taskId == null || stepIdx == null) continue;
      await deps.upsertStep(
        taskId.toString(),
        Number(stepIdx),
        configId?.toString() ?? "0",
        null,
        StepState.RunningExternal,
        decodePayload((payload as `0x${string}` | null) ?? "0x"),
        (reqId as `0x${string}` | null) ?? null,
        null,
        null,
        deadline == null ? null : Number(deadline),
      );
      deps.publish(taskId.toString(), "step_dispatched", {
        taskId: taskId.toString(),
        stepIdx,
        configId: configId?.toString(),
      });
    }

    const stepStateChangedLogs = await load(stepStateChangedEvent);
    logIndexerLogs("StepStateChanged", stepStateChangedLogs.length, from, to);
    for (const log of stepStateChangedLogs) {
      const { taskId, stepIdx, state } = log.args;
      if (taskId == null || stepIdx == null) continue;
      const stepState = Number(state ?? 0);
      let deadline: number | null = null;
      if (stepState === StepState.RunningNative && log.blockNumber != null) {
        const existing = await deps.getStep(taskId.toString(), Number(stepIdx));
        if (existing?.timeout_seconds != null) {
          deadline =
            (await deps.getBlockTimestamp(log.blockNumber)) + existing.timeout_seconds;
        }
      }
      await deps.upsertStep(
        taskId.toString(),
        Number(stepIdx),
        "0",
        null,
        stepState,
        "",
        null,
        null,
        null,
        deadline,
      );
      deps.publish(taskId.toString(), "step_state", {
        taskId: taskId.toString(),
        stepIdx,
        state,
        stateName: StepState[stepState] ?? "Unknown",
      });
    }

    const externalResultPendingLogs = await load(externalResultPendingEvent);
    logIndexerLogs(
      "ExternalResultPending",
      externalResultPendingLogs.length,
      from,
      to,
    );
    for (const log of externalResultPendingLogs) {
      const { taskId, stepIdx, result } = log.args;
      if (taskId == null || stepIdx == null) continue;
      await deps.upsertStep(
        taskId.toString(),
        Number(stepIdx),
        "0",
        null,
        StepState.AwaitingRating,
        "",
        null,
        (result as `0x${string}` | null) ?? "0x",
        null,
        null,
      );
      deps.publish(taskId.toString(), "step_result_pending", {
        taskId: taskId.toString(),
        stepIdx,
      });
    }

    const externalStepApprovedLogs = await load(externalStepApprovedEvent);
    logIndexerLogs(
      "ExternalStepApproved",
      externalStepApprovedLogs.length,
      from,
      to,
    );
    for (const log of externalStepApprovedLogs) {
      const { taskId, stepIdx, score } = log.args;
      if (taskId == null || stepIdx == null) continue;
      await deps.upsertStep(
        taskId.toString(),
        Number(stepIdx),
        "0",
        null,
        StepState.Succeeded,
        "",
        null,
        null,
        score == null ? null : Number(score),
        null,
      );
      deps.publish(taskId.toString(), "step_approved", {
        taskId: taskId.toString(),
        stepIdx,
        score,
      });
    }

    const externalStepRejectedLogs = await load(externalStepRejectedEvent);
    logIndexerLogs(
      "ExternalStepRejected",
      externalStepRejectedLogs.length,
      from,
      to,
    );
    for (const log of externalStepRejectedLogs) {
      const { taskId, stepIdx, score } = log.args;
      if (taskId == null || stepIdx == null) continue;
      await deps.upsertStep(
        taskId.toString(),
        Number(stepIdx),
        "0",
        null,
        StepState.Failed,
        "",
        null,
        null,
        score == null ? null : Number(score),
        null,
      );
      deps.publish(taskId.toString(), "step_rejected", {
        taskId: taskId.toString(),
        stepIdx,
        score,
      });
    }

    const taskCompletedLogs = await load(taskCompletedEvent);
    logIndexerLogs("TaskCompleted", taskCompletedLogs.length, from, to);
    for (const log of taskCompletedLogs) {
      const { taskId, result } = log.args;
      if (taskId == null) continue;
      await deps.updateTaskState(taskId.toString(), TaskState.Completed);
      await deps.finalizeTaskSteps(taskId.toString(), StepState.Succeeded);
      const resultText = typeof result === "string" ? result : undefined;
      const decodedResult =
        (log.data ? decodeTaskCompletionFromLogData(log.data as `0x${string}`) : null) ??
        normalizeDisplayText(resultText);
      deps.publish(taskId.toString(), "task_completed", {
        taskId: taskId.toString(),
        result: decodedResult,
        preview: taskTextPreview(decodedResult),
      });
    }

    const taskAbortedLogs = await load(taskAbortedEvent);
    logIndexerLogs("TaskAborted", taskAbortedLogs.length, from, to);
    for (const log of taskAbortedLogs) {
      const { taskId, reason } = log.args;
      if (taskId == null) continue;
      await deps.updateTaskState(taskId.toString(), TaskState.Aborted);
      await deps.finalizeTaskSteps(
        taskId.toString(),
        abortReasonToStepState(reason),
      );
      deps.publish(taskId.toString(), "task_aborted", {
        taskId: taskId.toString(),
        reason,
      });
    }

    const registryLoad = (event: AbiEvent) =>
      deps.getLogs({
        address: deps.addresses.agentRegistry,
        event,
        fromBlock: from,
        toBlock: to,
      });

    const externalAgentRegisteredLogs = await registryLoad(externalAgentRegisteredEvent);
    logIndexerLogs(
      "ExternalAgentRegistered",
      externalAgentRegisteredLogs.length,
      from,
      to,
    );
    for (const log of externalAgentRegisteredLogs) {
      const { configId, registrant, endpointUrl, endpointHash, caps } = log.args;
      if (
        configId == null ||
        registrant == null ||
        typeof endpointUrl !== "string" ||
        endpointHash == null
      ) {
        continue;
      }
      await deps.upsertExternalAgent(
        configId.toString(),
        registrant.toString(),
        endpointUrl,
        endpointHash.toString(),
        normalizeCapabilities(caps),
      );
    }

    const externalEndpointUpdatedLogs = await registryLoad(externalEndpointUpdatedEvent);
    logIndexerLogs(
      "ExternalEndpointUpdated",
      externalEndpointUpdatedLogs.length,
      from,
      to,
    );
    for (const log of externalEndpointUpdatedLogs) {
      const { configId, newUrl, newHash } = log.args;
      if (configId == null || typeof newUrl !== "string" || newHash == null) {
        continue;
      }
      const agentConfigId = configId.toString();
      const existing = await deps.getExternalAgent(agentConfigId);
      if (!existing) continue;
      await deps.upsertExternalAgent(
        agentConfigId,
        existing.registrant,
        newUrl,
        newHash.toString(),
        existing.capabilities,
      );
    }

    const externalDeregisteredLogs = await registryLoad(externalDeregisteredEvent);
    logIndexerLogs(
      "ExternalDeregistered",
      externalDeregisteredLogs.length,
      from,
      to,
    );
    for (const log of externalDeregisteredLogs) {
      const { configId } = log.args;
      if (configId == null) continue;
      await deps.deactivateExternalAgent(configId.toString());
    }

    await deps.setCursor(CURSOR_KEY, to + 1n);
  }

  async function poll(): Promise<void> {
    while (running) {
      try {
        await tick();
      } catch (e) {
        const msg = `${String(e)} ${String((e as { cause?: unknown }).cause ?? "")}`;
        if (
          msg.includes("keeper_cursors") ||
          msg.includes("turso.io") ||
          msg.includes("DrizzleQueryError")
        ) {
          console.error(
            "[indexer] database unreachable — keepers cannot index tasks. " +
              "For local dev set TURSO_DB_URL=file:./twiin.db in apps/backend/.env and restart.",
          );
        } else {
          console.error("[indexer] error:", e);
        }
      }
      await sleep(POLL_MS);
    }
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      void poll();
    },
    tick,
  };
}

function normalizeDisplayText(text: string | null | undefined): string | null {
  if (text == null) return null;

  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) return null;
  if (normalized.includes("\uFFFD")) return null;

  const printableChars = Array.from(normalized).filter((char) =>
    char === "\n" || char === "\t" || (char >= " " && char !== "\u007f"),
  ).length;

  if (printableChars / normalized.length < 0.9) return null;
  return normalized;
}

function taskTextPreview(
  text: string | null | undefined,
  maxLength = 120,
): string | null {
  const normalized = normalizeDisplayText(text);
  if (!normalized) return null;
  const singleLine = normalized.replace(/\s*\n\s*/g, " ").trim();
  if (!singleLine) return null;
  return singleLine.length > maxLength
    ? `${singleLine.slice(0, maxLength).trimEnd()}…`
    : singleLine;
}

function abortReasonToStepState(reason: unknown): number {
  const lower = typeof reason === "string" ? reason.toLowerCase() : "";
  if (
    lower.includes("timed out") ||
    lower.includes("time out") ||
    lower.includes("timeout")
  ) {
    return StepState.TimedOut;
  }
  return StepState.Failed;
}

function logIndexerLogs(
  eventType: string,
  count: number,
  fromBlock: bigint,
  toBlock: bigint,
): void {
  if (count <= 0) return;
  logTaskTimeline("indexer_logs", {
    eventType,
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    count,
  });
}

function decodePayload(hex: `0x${string}`): string {
  try {
    const bytes = Buffer.from(hex.slice(2), "hex");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return "";
  }
}

async function loadTaskStepsFromTransaction(
  deps: Pick<IndexerDeps, "getTransaction">,
  hash: `0x${string}` | null,
): Promise<DecodedTaskStep[]> {
  if (!hash) return [];

  try {
    const tx = await deps.getTransaction(hash);
    const outer = decodeFunctionData({
      abi: TwiinAccountAbi,
      data: tx.input,
    });
    if (outer.functionName !== "execute") return [];
    if (!outer.args) return [];

    const nestedCalldata = outer.args[2];
    if (typeof nestedCalldata !== "string") return [];

    const inner = decodeFunctionData({
      abi: AgentOrchestratorAbi,
      data: nestedCalldata as Hex,
    });
    if (inner.functionName !== "createTask") return [];
    if (!inner.args) return [];

    const steps = inner.args[1];
    if (!Array.isArray(steps)) return [];

    return steps.map((step) => ({
      configId: step.subAgentConfigId.toString(),
      payload: decodePayload(step.payload),
      timeoutSeconds: Number(step.timeoutSeconds),
    }));
  } catch {
    return [];
  }
}

function normalizeCapabilities(
  caps: `0x${string}`[] | bigint | number | string | `0x${string}` | null | undefined,
): string[] {
  return Array.isArray(caps)
    ? caps.filter((value): value is `0x${string}` => typeof value === "string")
    : [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const defaultIndexer = createIndexer();

export function startIndexer(): void {
  defaultIndexer.start();
}
