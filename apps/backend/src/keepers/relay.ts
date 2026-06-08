import {
  keccak256,
  parseAbiItem,
  recoverMessageAddress,
  toBytes,
  toHex,
  type AbiEvent,
} from "viem";
import { buildTwiinDigest, CHAIN_ID, StepState, TaskState, buildPriorStepContext, enrichExternalPayload } from "@twiin/shared";
import { publicClient } from "../clients";
import { addresses, defaultStartBlock, orchestratorContract } from "../contracts";
import { env } from "../env";
import {
  completeRelayJob,
  deleteSubmittedResult,
  enqueueRelayJob,
  getCursor,
  getExternalAgent,
  getRelayJob,
  getStep,
  getStepsForTask,
  isResultSubmitted,
  listDueRelayJobs,
  listFailedRelayJobs,
  markRelayJobIndexerLagRetry,
  markRelayJobRetry,
  reactivateRelayJob,
  saveSubmittedResult,
  setCursor,
  setExternalAgentVerification,
  upsertStep,
} from "../db";
import { enqueueKeeperWrite, isNonceCollisionError } from "../keeper-writes";
import { publish } from "../sse";
import { logTaskTimeline } from "../task-log";

const CURSOR_KEY = "relay";
const POLL_MS = 4_000;
const CHUNK = 500n;
const MAX_RPC_LOG_RANGE = 1_000n;
const FAST_FORWARD_LAG_THRESHOLD = 100_000n;
const FAST_FORWARD_TAIL = 10_000n;
const MAX_EXTERNAL_RESULT_SIZE = 16_384;
const RELAY_EXECUTE_RETRIES = 3;
const RELAY_BACKOFF_SECONDS = [2, 8, 32];
const RELAY_INDEXER_LAG_BACKOFF_SECONDS = 2;
const POST_EXECUTE_INDEXER_LAG_POLLS = 3;
const POST_EXECUTE_INDEXER_LAG_DELAY_MS = 1_000;
const EXTERNAL_VERIFICATION_TTL_SECONDS = 300;
const externalAgentRequestEvent = parseAbiItem(
  "event ExternalAgentRequest(uint256 indexed taskId, uint8 stepIdx, uint256 configId, address registrant, bytes32 endpointHash, bytes payload, bytes32 reqId, uint64 deadline)",
) as AbiEvent;

type RelayLogArgs = {
  taskId?: bigint | null;
  stepIdx?: number | null;
  configId?: bigint | null;
  registrant?: `0x${string}` | null;
  endpointHash?: `0x${string}` | null;
  payload?: `0x${string}` | null;
  reqId?: `0x${string}` | null;
  deadline?: bigint | null;
};

type ExternalAgentRow = NonNullable<Awaited<ReturnType<typeof getExternalAgent>>>;

type RelayDeps = {
  getBlockNumber: () => Promise<bigint>;
  getLogs: (args: {
    address: `0x${string}`;
    event: AbiEvent;
    fromBlock: bigint;
    toBlock: bigint;
  }) => Promise<Array<{ args: RelayLogArgs }>>;
  chainId: bigint;
  addresses: { orchestrator: `0x${string}` };
  startBlock: bigint;
  getCursor: (name: string) => Promise<bigint>;
  setCursor: (name: string, block: bigint) => Promise<void>;
  isResultSubmitted: typeof isResultSubmitted;
  saveSubmittedResult: typeof saveSubmittedResult;
  deleteSubmittedResult: typeof deleteSubmittedResult;
  getStep: typeof getStep;
  getStepsForTask: typeof getStepsForTask;
  upsertStep: typeof upsertStep;
  getExternalAgent: typeof getExternalAgent;
  setExternalAgentVerification: typeof setExternalAgentVerification;
  enqueueRelayJob: typeof enqueueRelayJob;
  getRelayJob: typeof getRelayJob;
  listDueRelayJobs: typeof listDueRelayJobs;
  listFailedRelayJobs: typeof listFailedRelayJobs;
  markRelayJobRetry: typeof markRelayJobRetry;
  markRelayJobIndexerLagRetry: typeof markRelayJobIndexerLagRetry;
  reactivateRelayJob: typeof reactivateRelayJob;
  completeRelayJob: typeof completeRelayJob;
  publish: typeof publish;
  readOnChainTask: (
    taskId: bigint,
  ) => Promise<readonly [number, bigint, number, bigint, bigint, bigint, number]>;
  submitExternalResult: (
    args: readonly [bigint, number, `0x${string}`, `0x${string}`],
  ) => Promise<unknown>;
  fetchImpl: typeof fetch;
  nowMs: () => number;
  logger: Pick<Console, "log" | "error" | "warn">;
};

type ExecuteResponse = {
  result?: string;
  resultHex?: `0x${string}`;
  signature?: `0x${string}`;
  registrant?: `0x${string}`;
};

export function createRelay(overrides: Partial<RelayDeps> = {}) {
  const deps: RelayDeps = {
    getBlockNumber: () => publicClient.getBlockNumber(),
    getLogs: (args) =>
      publicClient.getLogs(args) as Promise<Array<{ args: RelayLogArgs }>>,
    chainId: BigInt(CHAIN_ID),
    addresses: { orchestrator: addresses.orchestrator },
    startBlock: env.START_BLOCK ?? defaultStartBlock,
    getCursor,
    setCursor,
    isResultSubmitted,
    saveSubmittedResult,
    deleteSubmittedResult,
    getStep,
    getStepsForTask,
    upsertStep,
    getExternalAgent,
    setExternalAgentVerification,
    enqueueRelayJob,
    getRelayJob,
    listDueRelayJobs,
    listFailedRelayJobs,
    markRelayJobRetry,
    markRelayJobIndexerLagRetry,
    reactivateRelayJob,
    completeRelayJob,
    publish,
    readOnChainTask: (taskId) =>
      orchestratorContract.read.tasks([taskId]),
    submitExternalResult: (args) =>
      enqueueKeeperWrite(() =>
        orchestratorContract.write.submitExternalResult(args),
      ),
    fetchImpl: fetch,
    nowMs: () => Date.now(),
    logger: console,
    ...overrides,
  };

  let running = false;

  async function tick(): Promise<void> {
    const latest = await deps.getBlockNumber();
    const stored = await deps.getCursor(CURSOR_KEY);
    if (stored > latest) {
      const rewindTo = latest > 1n ? latest - 1n : 0n;
      deps.logger.warn(
        `[relay] cursor ${stored} is ahead of latest block ${latest}; rewinding to ${rewindTo}`,
      );
      await deps.setCursor(CURSOR_KEY, rewindTo);
    } else {
      const from = stored === 0n && deps.startBlock > 0n ? deps.startBlock : stored;
      if (from <= latest) {
        const lag = latest - from;
        let fastForwarded = false;
        if (lag > FAST_FORWARD_LAG_THRESHOLD) {
          const fastForwardTo =
            latest > FAST_FORWARD_TAIL ? latest - FAST_FORWARD_TAIL : 0n;
          if (fastForwardTo > from) {
            deps.logger.warn(
              `[relay] lag ${lag} blocks is too large; fast-forwarding cursor from ${from} to ${fastForwardTo}`,
            );
            await deps.setCursor(CURSOR_KEY, fastForwardTo);
            fastForwarded = true;
          }
        }
        
        if (!fastForwarded) {
          const chunk = lag > MAX_RPC_LOG_RANGE ? MAX_RPC_LOG_RANGE : CHUNK;
          const to = from + chunk < latest ? from + chunk : latest;
          const logs = await deps.getLogs({
            address: deps.addresses.orchestrator,
            event: externalAgentRequestEvent,
            fromBlock: from,
            toBlock: to,
          });

          for (const log of logs) {
            const {
              taskId,
              stepIdx,
              configId,
              registrant,
              endpointHash,
              payload,
              reqId,
              deadline,
            } = log.args;
            if (
              taskId == null ||
              stepIdx == null ||
              configId == null ||
              registrant == null ||
              endpointHash == null ||
              reqId == null
            ) {
              continue;
            }

            const taskIdStr = taskId.toString();

            if (deadline && BigInt(Math.floor(deps.nowMs() / 1000)) > deadline) {
              deps.logger.log(
                `[relay] step ${taskIdStr}:${stepIdx} deadline passed, skipping`,
              );
              logTaskTimeline("relay_step_expired", {
                taskId: taskIdStr,
                stepIdx,
                configId: configId.toString(),
                deadline: deadline.toString(),
              });
              continue;
            }

            try {
              logTaskTimeline("relay_step_detected", {
                taskId: taskIdStr,
                stepIdx,
                configId: configId.toString(),
                deadline: deadline?.toString() ?? null,
              });
              await scheduleRelayJobDispatch(deps, {
                taskId: taskIdStr,
                stepIdx,
                configId: configId.toString(),
                reqId,
                payload: payload ?? "0x",
                registrant,
                endpointHash,
              });
            } catch (e) {
              deps.logger.error(`[relay] enqueue failed task=${taskIdStr} step=${stepIdx}:`, e);
            }
          }

          await deps.setCursor(CURSOR_KEY, to + 1n);

          await recoverFailedRelayJobs(deps);
          await processRelayJobs(deps);
          return;
        }
      }
    }

    await recoverFailedRelayJobs(deps);
    await processRelayJobs(deps);
  }

  async function processRelayJobs(deps: RelayDeps): Promise<void> {
    const nowSeconds = Math.floor(deps.nowMs() / 1000);
    const jobs = await deps.listDueRelayJobs(nowSeconds);
    if (jobs.length > 0) deps.logger.log(`[relay] processRelayJobs found ${jobs.length} jobs at ${nowSeconds}`);
    for (const job of jobs) {
      if (await deps.isResultSubmitted(job.task_id, job.step_idx)) {
        const stepRow = await deps.getStep(job.task_id, job.step_idx);
        const configId = BigInt(job.config_id);
        const reqId = job.req_id as `0x${string}`;
        if (
          stepRow &&
          stepRow.state === StepState.RunningExternal &&
          isStepAlignedWithDispatch(stepRow, configId, reqId)
        ) {
          logTaskTimeline("relay_dedup_stale_cleared", {
            taskId: job.task_id,
            stepIdx: job.step_idx,
            configId: job.config_id,
            reqId: job.req_id,
          });
          await deps.deleteSubmittedResult(job.task_id, job.step_idx);
        } else {
          await deps.completeRelayJob(job.task_id, job.step_idx);
          continue;
        }
      }
      try {
        await processExternalStep(deps, {
          taskId: BigInt(job.task_id),
          stepIdx: job.step_idx,
          configId: BigInt(job.config_id),
          registrant: job.registrant as `0x${string}`,
          endpointHash: job.endpoint_hash as `0x${string}`,
          payload: job.payload as `0x${string}`,
          reqId: job.req_id as `0x${string}`,
        });
        await deps.completeRelayJob(job.task_id, job.step_idx);
      } catch (e) {
        if (isIndexerLagError(e) || isNonceCollisionError(e)) {
          const nextRetryAt = nowSeconds + RELAY_INDEXER_LAG_BACKOFF_SECONDS;
          await deps.markRelayJobIndexerLagRetry(
            job.task_id,
            job.step_idx,
            nextRetryAt,
            String(e),
          );
          logTaskTimeline(
            isNonceCollisionError(e) ? "relay_nonce_retry" : "relay_indexer_lag",
            {
              taskId: job.task_id,
              stepIdx: job.step_idx,
              attempts: job.attempts,
              nextRetryAt,
              error: String(e),
            },
          );
          deps.logger.log(
            `[relay] ${isNonceCollisionError(e) ? "nonce collision" : "indexer lag"} task=${job.task_id} step=${job.step_idx}, retry at ${nextRetryAt}`,
          );
          continue;
        }

        const attempts = job.attempts + 1;
        const backoff =
          RELAY_BACKOFF_SECONDS[Math.min(attempts - 1, RELAY_BACKOFF_SECONDS.length - 1)];
        const nextRetryAt = nowSeconds + backoff;
        await deps.markRelayJobRetry(
          job.task_id,
          job.step_idx,
          attempts,
          nextRetryAt,
          String(e),
        );
        logTaskTimeline(attempts >= RELAY_EXECUTE_RETRIES ? "relay_exhausted" : "relay_retry", {
          taskId: job.task_id,
          stepIdx: job.step_idx,
          attempts,
          nextRetryAt,
          error: String(e),
        });
        deps.logger.error(
          `[relay] job failed task=${job.task_id} step=${job.step_idx} attempt=${attempts}:`,
          e,
        );
      }
    }
  }

  async function poll(): Promise<void> {
    while (running) {
      try {
        await tick();
      } catch (e) {
        deps.logger.error("[relay] error:", e);
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

type StepRow = NonNullable<Awaited<ReturnType<typeof getStep>>>;

type RelayJobInput = {
  taskId: string;
  stepIdx: number;
  configId: string;
  reqId: `0x${string}`;
  payload: string;
  registrant: string;
  endpointHash: string;
};

function isIndexerLagError(error: unknown): boolean {
  const message = String(error);
  return (
    message.includes("(indexer_lag)") ||
    message.includes("step state Pending after execute")
  );
}

async function scheduleRelayJobDispatch(
  deps: RelayDeps,
  input: RelayJobInput,
): Promise<boolean> {
  await deps.deleteSubmittedResult(input.taskId, input.stepIdx);
  const inserted = await deps.enqueueRelayJob(input);
  if (inserted) return true;

  const existing = await deps.getRelayJob(input.taskId, input.stepIdx);
  if (existing?.status === "failed") {
    await deps.reactivateRelayJob(input);
    return true;
  }
  return false;
}

async function recoverFailedRelayJobs(deps: RelayDeps): Promise<void> {
  const failedJobs = await deps.listFailedRelayJobs();
  for (const job of failedJobs) {
    if (await deps.isResultSubmitted(job.task_id, job.step_idx)) continue;

    const taskId = BigInt(job.task_id);
    const onChainTask = await deps.readOnChainTask(taskId);
    const taskState = Number(onChainTask[6]);
    if (taskState !== TaskState.Running) continue;

    const stepRow = await deps.getStep(job.task_id, job.step_idx);
    const stillNeedsRelay =
      stepRow == null ||
      stepRow.state === StepState.Pending ||
      stepRow.state === StepState.RunningExternal;
    if (!stillNeedsRelay) continue;

    await deps.reactivateRelayJob({
      taskId: job.task_id,
      stepIdx: job.step_idx,
      configId: job.config_id,
      reqId: job.req_id,
      payload: job.payload,
      registrant: job.registrant,
      endpointHash: job.endpoint_hash,
    });
    logTaskTimeline("relay_job_reactivated", {
      taskId: job.task_id,
      stepIdx: job.step_idx,
      configId: job.config_id,
      stepState: stepRow?.state ?? null,
    });
    deps.logger.log(
      `[relay] reactivated failed job task=${job.task_id} step=${job.step_idx}`,
    );
  }
}

function isStepAlignedWithDispatch(
  row: StepRow,
  configId: bigint,
  reqId: `0x${string}`,
): boolean {
  return (
    row.config_id === configId.toString() &&
    row.req_id != null &&
    row.req_id.toLowerCase() === reqId.toLowerCase()
  );
}

async function waitForRunningExternalStep(
  deps: RelayDeps,
  taskIdStr: string,
  stepIdx: number,
  configId: bigint,
  reqId: `0x${string}`,
): Promise<StepRow | null> {
  let row = await deps.getStep(taskIdStr, stepIdx);
  for (let poll = 0; poll < POST_EXECUTE_INDEXER_LAG_POLLS; poll += 1) {
    if (
      row &&
      row.state === StepState.RunningExternal &&
      isStepAlignedWithDispatch(row, configId, reqId)
    ) {
      return row;
    }
    if (row && row.state !== StepState.Pending) {
      return row;
    }
    await sleep(POST_EXECUTE_INDEXER_LAG_DELAY_MS);
    row = await deps.getStep(taskIdStr, stepIdx);
  }
  return row;
}

function stepDispatchDetails(
  row: StepRow | null,
  configId: bigint,
  reqId: `0x${string}`,
) {
  return {
    configId: configId.toString(),
    expectedReqId: reqId,
    rowConfigId: row?.config_id ?? null,
    rowReqId: row?.req_id ?? null,
    rowState: row?.state ?? null,
  };
}

async function processExternalStep(
  deps: RelayDeps,
  params: {
    taskId: bigint;
    stepIdx: number;
    configId: bigint;
    registrant: `0x${string}`;
    endpointHash: `0x${string}`;
    payload: `0x${string}`;
    reqId: `0x${string}`;
  },
): Promise<void> {
  const { taskId, stepIdx, configId, registrant, endpointHash, payload, reqId } =
    params;
  const taskIdStr = taskId.toString();

  const agent = await deps.getExternalAgent(configId.toString());
  if (!agent || agent.is_active !== 1) {
    throw new Error(`external agent ${configId} not cached or inactive`);
  }
  if (
    agent.registrant.toLowerCase() !== registrant.toLowerCase() ||
    agent.endpoint_hash.toLowerCase() !== endpointHash.toLowerCase()
  ) {
    throw new Error(`external agent ${configId} cache mismatch`);
  }

  if (!(await ensureVerified(deps, agent, configId))) {
    throw new Error(`external agent ${configId} failed verification`);
  }

  const preExecuteRow = await deps.getStep(taskIdStr, stepIdx);
  const preStepReady = preExecuteRow !== null &&
    isStepAlignedWithDispatch(preExecuteRow, configId, reqId) &&
    preExecuteRow.state === StepState.RunningExternal;

  if (!preStepReady) {
    const maybeIndexerLag = !preExecuteRow || preExecuteRow.state === StepState.Pending;

    if (maybeIndexerLag) {
      const onChainTask = await deps.readOnChainTask(taskId);
      const taskState = Number(onChainTask[6]);
      if (taskState === TaskState.Running) {
        logTaskTimeline("relay_step_chain_fallback", {
          taskId: taskIdStr,
          stepIdx,
          configId: configId.toString(),
        });
      } else {
        logTaskTimeline("relay_step_not_ready", {
          taskId: taskIdStr,
          stepIdx,
          phase: "pre_execute",
          reason: taskState === TaskState.Created ? "task_not_running" : "task_done",
          ...stepDispatchDetails(preExecuteRow, configId, reqId),
        });
        throw new Error(
          `step not ready for dispatch (pre_execute) task=${taskIdStr} step=${stepIdx} taskState=${taskState}`,
        );
      }
    } else {
      logTaskTimeline("relay_step_not_ready", {
        taskId: taskIdStr,
        stepIdx,
        phase: "pre_execute",
        reason: "step_state_mismatch",
        ...stepDispatchDetails(preExecuteRow, configId, reqId),
      });
      throw new Error(
        `step not ready for dispatch (pre_execute) task=${taskIdStr} step=${stepIdx} state=${preExecuteRow.state}`,
      );
    }
  }

  const timeoutSeconds = preExecuteRow?.timeout_seconds ?? 120;

  const enrichedPayload = await enrichPayloadWithPriorContext(
    deps,
    taskIdStr,
    stepIdx,
    payload,
  );
  const { resultHex, signature } = await executeExternalAgent(
    deps,
    agent,
    taskId,
    stepIdx,
    enrichedPayload,
    reqId,
    timeoutSeconds,
  );

  const freshStepRow = await waitForRunningExternalStep(
    deps,
    taskIdStr,
    stepIdx,
    configId,
    reqId,
  );
  const alreadySubmitted = await deps.isResultSubmitted(taskIdStr, stepIdx);

  if (alreadySubmitted) {
    logTaskTimeline("relay_step_skipped", {
      taskId: taskIdStr,
      stepIdx,
      configId: configId.toString(),
      staleState: preExecuteRow?.state ?? null,
      freshState: freshStepRow?.state ?? null,
      reason: "already_submitted",
    });
    return;
  }

  const stepStillAligned = freshStepRow !== null &&
    isStepAlignedWithDispatch(freshStepRow, configId, reqId);

  if (!stepStillAligned) {
    const maybeIndexerLag = !freshStepRow || freshStepRow.state === StepState.Pending;

    if (maybeIndexerLag) {
      const onChainTask = await deps.readOnChainTask(taskId);
      const taskState = Number(onChainTask[6]);
      if (taskState === TaskState.Running) {
        logTaskTimeline("relay_step_chain_fallback_post", {
          taskId: taskIdStr,
          stepIdx,
          configId: configId.toString(),
        });
      } else {
        logTaskTimeline("relay_step_skipped", {
          taskId: taskIdStr,
          stepIdx,
          configId: configId.toString(),
          reason: "task_not_running_after_execute",
        });
        return;
      }
    } else {
      logTaskTimeline("relay_step_not_ready", {
        taskId: taskIdStr,
        stepIdx,
        phase: "post_execute",
        reason: "misaligned_after_execute",
        ...stepDispatchDetails(freshStepRow, configId, reqId),
      });
      throw new Error(
        `step misaligned after execute task=${taskIdStr} step=${stepIdx}`,
      );
    }
  }

  if (freshStepRow && freshStepRow.state !== StepState.RunningExternal) {
    logTaskTimeline("relay_step_skipped", {
      taskId: taskIdStr,
      stepIdx,
      configId: configId.toString(),
      staleState: preExecuteRow?.state ?? null,
      freshState: freshStepRow.state,
      reason:
        freshStepRow.state === StepState.Pending
          ? "indexer_lag_pending"
          : "terminal_state",
    });

    deps.logger.log(
      `[relay] step ${taskIdStr}:${stepIdx} freshState=${freshStepRow.state} not RunningExternal; skipping`,
    );

    if (freshStepRow.state === StepState.Pending) {
      throw new Error(
        `step state Pending after execute for task=${taskIdStr} step=${stepIdx} (indexer_lag)`,
      );
    }

    return;
  }

  await deps.saveSubmittedResult(taskIdStr, stepIdx, resultHex, signature);
  try {
    logTaskTimeline("relay_submitting_result", {
      taskId: taskIdStr,
      stepIdx,
      configId: configId.toString(),
      resultBytes: (resultHex.length - 2) / 2,
    });
    await deps.submitExternalResult([taskId, stepIdx, resultHex, signature]);
  } catch (e) {
    await deps.deleteSubmittedResult(taskIdStr, stepIdx);
    throw e;
  }

  const payloadText = decodePayload(payload);
  await deps.upsertStep(
    taskIdStr,
    stepIdx,
    configId.toString(),
    null,
    StepState.AwaitingRating,
    payloadText,
    reqId,
    resultHex,
    null,
    null,
  );
  deps.publish(taskIdStr, "step_result_submitted", { taskId: taskIdStr, stepIdx });
  logTaskTimeline("relay_result_submitted", {
    taskId: taskIdStr,
    stepIdx,
    configId: configId.toString(),
  });
  deps.logger.log(
    `[relay] submitted external result task=${taskIdStr} step=${stepIdx} config=${configId}`,
  );
}

async function enrichPayloadWithPriorContext(
  deps: RelayDeps,
  taskIdStr: string,
  stepIdx: number,
  payloadHex: `0x${string}`,
): Promise<`0x${string}`> {
  if (stepIdx <= 0) return payloadHex;

  const steps = await deps.getStepsForTask(taskIdStr);
  const priorContext = buildPriorStepContext(
    steps.map((row) => ({
      stepIdx: row.step_idx,
      configId: row.config_id,
      resultHex: row.result_hex,
      payload: row.payload,
    })),
    stepIdx,
  );

  return enrichExternalPayload(payloadHex, priorContext);
}

async function ensureVerified(
  deps: RelayDeps,
  agent: ExternalAgentRow,
  configId: bigint,
  options: { force?: boolean } = {},
): Promise<boolean> {
  if (!options.force && agent.is_verified === 1) return true;

  try {
    const healthRes = await deps.fetchImpl(new URL("/health", agent.endpoint_url), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!healthRes.ok) {
      throw new Error(`health check failed with ${healthRes.status}`);
    }
    const health = (await healthRes.json()) as {
      status?: string;
      registrant?: string;
    };
    if (
      health.status !== "ok" ||
      health.registrant?.toLowerCase() !== agent.registrant.toLowerCase()
    ) {
      throw new Error("health registrant mismatch");
    }

    const reqId = keccak256(
      toBytes(`verify:${configId.toString()}:${deps.nowMs()}`),
    );
    const execute = await runExecute(deps, agent, 0n, 0, "0x", reqId, 30);
    await verifySignedResult(
      deps,
      0n,
      0,
      reqId,
      agent.registrant as `0x${string}`,
      execute.resultHex,
      execute.signature,
    );

    await deps.setExternalAgentVerification(configId.toString(), true, null);
    return true;
  } catch (error) {
    await deps.setExternalAgentVerification(
      configId.toString(),
      false,
      String(error),
    );
    deps.logger.warn(
      `[relay] verification failed for config=${configId.toString()}: ${String(error)}`,
    );
    return false;
  }
}

async function executeExternalAgent(
  deps: RelayDeps,
  agent: ExternalAgentRow,
  taskId: bigint,
  stepIdx: number,
  payloadHex: `0x${string}`,
  reqId: `0x${string}`,
  timeoutSeconds: number,
): Promise<{ resultHex: `0x${string}`; signature: `0x${string}` }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RELAY_EXECUTE_RETRIES; attempt++) {
    try {
      const execute = await runExecute(
        deps,
        agent,
        taskId,
        stepIdx,
        payloadHex,
        reqId,
        timeoutSeconds,
      );
      await verifySignedResult(
        deps,
        taskId,
        stepIdx,
        reqId,
        agent.registrant as `0x${string}`,
        execute.resultHex,
        execute.signature,
      );
      return execute;
    } catch (error) {
      lastError = error;
      deps.logger.warn(
        `[relay] executeExternalAgent attempt ${attempt + 1}/${RELAY_EXECUTE_RETRIES} failed task=${taskId} step=${stepIdx} agent=${agent.endpoint_url}: ${String(error)}`,
      );
      const retriable =
        error instanceof Error &&
        (error.message.includes("502") ||
          error.message.includes("503") ||
          error.message.includes("504") ||
          error.message.includes("fetch failed") ||
          error.message.includes("network"));
      if (!retriable || attempt >= RELAY_EXECUTE_RETRIES - 1) break;
      await sleep(RELAY_BACKOFF_SECONDS[attempt] * 1000);
    }
  }
  deps.logger.error(
    `[relay] executeExternalAgent exhausted task=${taskId} step=${stepIdx} agent=${agent.endpoint_url} after ${RELAY_EXECUTE_RETRIES} attempts: ${String(lastError)}`,
  );
  throw lastError ?? new Error("execute failed");
}

async function runExecute(
  deps: RelayDeps,
  agent: ExternalAgentRow,
  taskId: bigint,
  stepIdx: number,
  payloadHex: `0x${string}`,
  reqId: `0x${string}`,
  timeoutSeconds = 120,
): Promise<{ resultHex: `0x${string}`; signature: `0x${string}` }> {
  const timeoutMs = Math.min(timeoutSeconds * 1000, 120_000);
  const res = await deps.fetchImpl(new URL("/execute", agent.endpoint_url), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      taskId: taskId.toString(),
      stepIdx,
      payload: payloadHex.slice(2),
      reqId,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    throw new Error(`execute failed with ${res.status}`);
  }

  const body = (await res.json()) as ExecuteResponse;
  if (!body.signature) throw new Error("missing signature");
  const resultHex = normalizeResult(body);
  if (toBytes(resultHex).length > MAX_EXTERNAL_RESULT_SIZE) {
    throw new Error("result exceeds 16 KB cap");
  }
  if (
    body.registrant &&
    body.registrant.toLowerCase() !== agent.registrant.toLowerCase()
  ) {
    throw new Error("execute registrant mismatch");
  }
  return { resultHex, signature: body.signature };
}

async function verifySignedResult(
  deps: RelayDeps,
  taskId: bigint,
  stepIdx: number,
  reqId: `0x${string}`,
  registrant: `0x${string}`,
  resultHex: `0x${string}`,
  signature: `0x${string}`,
): Promise<void> {
  const digest = buildTwiinDigest({
    chainId: deps.chainId,
    orchestrator: deps.addresses.orchestrator,
    taskId,
    stepIdx,
    externalRequestId: reqId,
    result: resultHex,
  });

  const recovered = await recoverMessageAddress({
    message: { raw: digest },
    signature,
  });
  if (recovered.toLowerCase() !== registrant.toLowerCase()) {
    throw new Error("signed result registrant mismatch");
  }
}

function normalizeResult(body: ExecuteResponse): `0x${string}` {
  if (body.resultHex) return body.resultHex;
  if (typeof body.result === "string") {
    return toHex(new TextEncoder().encode(body.result)) as `0x${string}`;
  }
  throw new Error("missing result");
}

function decodePayload(hex: `0x${string}`): string {
  try {
    return new TextDecoder().decode(Buffer.from(hex.slice(2), "hex"));
  } catch {
    return hex;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const defaultRelay = createRelay();

export function startRelay(): void {
  defaultRelay.start();
}

export async function verifyExternalAgentCacheEntry(
  configId: string,
): Promise<boolean> {
  const agent = await getExternalAgent(configId);
  if (!agent || agent.is_active !== 1) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const needsRefresh =
    agent.is_verified !== 1 ||
    agent.last_verified_at == null ||
    nowSeconds - agent.last_verified_at >= EXTERNAL_VERIFICATION_TTL_SECONDS;
  return ensureVerified(defaultRelayDeps, agent, BigInt(configId), {
    force: needsRefresh,
  });
}

const defaultRelayDeps = {
  getBlockNumber: () => publicClient.getBlockNumber(),
  getLogs: (args: {
    address: `0x${string}`;
    event: AbiEvent;
    fromBlock: bigint;
    toBlock: bigint;
  }) =>
    publicClient.getLogs(args) as Promise<Array<{ args: RelayLogArgs }>>,
  chainId: BigInt(CHAIN_ID),
  addresses: { orchestrator: addresses.orchestrator },
  startBlock: env.START_BLOCK ?? defaultStartBlock,
  getCursor,
  setCursor,
  isResultSubmitted,
  saveSubmittedResult,
  deleteSubmittedResult,
  getStep,
  getStepsForTask,
  upsertStep,
  getExternalAgent,
  setExternalAgentVerification,
  enqueueRelayJob,
  getRelayJob,
  listDueRelayJobs,
  listFailedRelayJobs,
  markRelayJobRetry,
  markRelayJobIndexerLagRetry,
  reactivateRelayJob,
  completeRelayJob,
  publish,
  readOnChainTask: (taskId: bigint) =>
    orchestratorContract.read.tasks([taskId]),
  submitExternalResult: (args: readonly [bigint, number, `0x${string}`, `0x${string}`]) =>
    enqueueKeeperWrite(() =>
      orchestratorContract.write.submitExternalResult(args),
    ),
  fetchImpl: fetch,
  nowMs: () => Date.now(),
  logger: console,
} satisfies RelayDeps;
