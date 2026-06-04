import { parseAbiItem, type AbiEvent } from "viem";
import { StepState, TaskState } from "@twiin/shared";
import { publicClient } from "../clients";
import { addresses, defaultStartBlock } from "../contracts";
import {
  deactivateExternalAgent,
  deleteStepsForTask,
  getExternalAgent,
  getCursor,
  setCursor,
  updateTaskState,
  upsertExternalAgent,
  upsertStep,
  upsertTask,
} from "../db";
import { env } from "../env";
import { publish } from "../sse";

const CURSOR_KEY = "indexer";
const POLL_MS = 4_000;
const CHUNK = 500n;

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

type IndexerDeps = {
  getBlockNumber: () => Promise<bigint>;
  getLogs: (args: {
    address: `0x${string}`;
    event: AbiEvent;
    fromBlock: bigint;
    toBlock: bigint;
  }) => Promise<Array<{ args: LogArgs; blockNumber?: bigint | null }>>;
  addresses: { orchestrator: `0x${string}`; agentRegistry: `0x${string}` };
  startBlock: bigint;
  getCursor: (name: string) => Promise<bigint>;
  setCursor: (name: string, block: bigint) => Promise<void>;
  getExternalAgent: typeof getExternalAgent;
  upsertExternalAgent: typeof upsertExternalAgent;
  deactivateExternalAgent: typeof deactivateExternalAgent;
  upsertTask: typeof upsertTask;
  deleteStepsForTask: typeof deleteStepsForTask;
  upsertStep: typeof upsertStep;
  updateTaskState: typeof updateTaskState;
  publish: typeof publish;
};

export function createIndexer(overrides: Partial<IndexerDeps> = {}) {
  const deps: IndexerDeps = {
    getBlockNumber: () => publicClient.getBlockNumber(),
    getLogs: (args) =>
      publicClient.getLogs(args) as Promise<
        Array<{ args: LogArgs; blockNumber?: bigint | null }>
      >,
    addresses: {
      orchestrator: addresses.orchestrator,
      agentRegistry: addresses.agentRegistry,
    },
    startBlock: env.START_BLOCK ?? defaultStartBlock,
    getCursor,
    setCursor,
    getExternalAgent,
    upsertExternalAgent,
    deactivateExternalAgent,
    upsertTask,
    deleteStepsForTask,
    upsertStep,
    updateTaskState,
    publish,
    ...overrides,
  };

  let running = false;

  async function tick(): Promise<void> {
    const latest = await deps.getBlockNumber();
    const stored = await deps.getCursor(CURSOR_KEY);
    const from = stored === 0n && deps.startBlock > 0n ? deps.startBlock : stored;
    if (from > latest) return;
    const to = from + CHUNK < latest ? from + CHUNK : latest;

    const load = (event: AbiEvent) =>
      deps.getLogs({
        address: deps.addresses.orchestrator,
        event,
        fromBlock: from,
        toBlock: to,
      });

    for (const log of await load(taskCreatedEvent)) {
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
      deps.publish(taskId.toString(), "task_created", {
        taskId: taskId.toString(),
        personalAgentId: personalAgentId.toString(),
        mode,
        budgetWei: budgetWei?.toString(),
      });
    }

    for (const log of await load(externalAgentRequestEvent)) {
      const { taskId, stepIdx, configId, payload, reqId, deadline } = log.args;
      if (taskId == null || stepIdx == null) continue;
      await deps.upsertStep(
        taskId.toString(),
        Number(stepIdx),
        configId?.toString() ?? "0",
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

    for (const log of await load(stepStateChangedEvent)) {
      const { taskId, stepIdx, state } = log.args;
      if (taskId == null || stepIdx == null) continue;
      await deps.upsertStep(
        taskId.toString(),
        Number(stepIdx),
        "0",
        Number(state ?? 0),
        "",
        null,
        null,
        null,
        null,
      );
      deps.publish(taskId.toString(), "step_state", {
        taskId: taskId.toString(),
        stepIdx,
        state,
        stateName: StepState[Number(state ?? 0)] ?? "Unknown",
      });
    }

    for (const log of await load(externalResultPendingEvent)) {
      const { taskId, stepIdx, result } = log.args;
      if (taskId == null || stepIdx == null) continue;
      await deps.upsertStep(
        taskId.toString(),
        Number(stepIdx),
        "0",
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

    for (const log of await load(externalStepApprovedEvent)) {
      const { taskId, stepIdx, score } = log.args;
      if (taskId == null || stepIdx == null) continue;
      await deps.upsertStep(
        taskId.toString(),
        Number(stepIdx),
        "0",
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

    for (const log of await load(externalStepRejectedEvent)) {
      const { taskId, stepIdx, score } = log.args;
      if (taskId == null || stepIdx == null) continue;
      await deps.upsertStep(
        taskId.toString(),
        Number(stepIdx),
        "0",
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

    for (const log of await load(taskCompletedEvent)) {
      const { taskId, result } = log.args;
      if (taskId == null) continue;
      await deps.updateTaskState(taskId.toString(), TaskState.Completed);
      deps.publish(taskId.toString(), "task_completed", {
        taskId: taskId.toString(),
        result,
      });
    }

    for (const log of await load(taskAbortedEvent)) {
      const { taskId, reason } = log.args;
      if (taskId == null) continue;
      await deps.updateTaskState(taskId.toString(), TaskState.Aborted);
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

    for (const log of await registryLoad(externalAgentRegisteredEvent)) {
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

    for (const log of await registryLoad(externalEndpointUpdatedEvent)) {
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

    for (const log of await registryLoad(externalDeregisteredEvent)) {
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

function decodePayload(hex: `0x${string}`): string {
  try {
    const bytes = Buffer.from(hex.slice(2), "hex");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return "";
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
