import { StepState, TaskState } from "@twiin/shared";
import { orchestratorContract } from "../contracts";
import { enqueueKeeperWrite } from "../keeper-writes";
import {
  clearStepDeadline,
  getTimedOutSteps,
  listRunningTaskIds,
} from "../db";
import { logTaskTimeline } from "../task-log";

const POLL_MS = 5_000;

type TimeoutDeps = {
  clearStepDeadline: typeof clearStepDeadline;
  getTimedOutSteps: typeof getTimedOutSteps;
  readNextTaskId: () => Promise<bigint>;
  readTask: (
    taskId: bigint,
  ) => Promise<readonly [number, bigint, number, bigint, bigint, bigint, number]>;
  timeoutExternalStep: (args: readonly [bigint, number]) => Promise<unknown>;
  timeoutRating: (args: readonly [bigint, number]) => Promise<unknown>;
  timeoutNativeStep: (args: readonly [bigint, number]) => Promise<unknown>;
  timeoutTask: (args: readonly [bigint]) => Promise<unknown>;
  nowSeconds: () => number;
  logger: Pick<Console, "log" | "warn" | "error">;
};

export function createTimeoutKeeper(overrides: Partial<TimeoutDeps> = {}) {
  const deps: TimeoutDeps = {
    clearStepDeadline,
    getTimedOutSteps,
    readNextTaskId: () => orchestratorContract.read.nextTaskId(),
    readTask: (taskId) => orchestratorContract.read.tasks([taskId]),
    timeoutExternalStep: (args) =>
      enqueueKeeperWrite(() =>
        orchestratorContract.write.timeoutExternalStep(args),
      ),
    timeoutRating: (args) =>
      enqueueKeeperWrite(() =>
        orchestratorContract.write.timeoutRating(args),
      ),
    timeoutNativeStep: (args) =>
      enqueueKeeperWrite(() =>
        orchestratorContract.write.timeoutNativeStep(args),
      ),
    timeoutTask: (args) =>
      enqueueKeeperWrite(() =>
        orchestratorContract.write.timeoutTask(args),
      ),
    nowSeconds: () => Math.floor(Date.now() / 1000),
    logger: console,
    ...overrides,
  };

  let running = false;

  async function tick(): Promise<void> {
    const now = deps.nowSeconds();
    const timedOutSteps = await deps.getTimedOutSteps(now);
    for (const step of timedOutSteps) {
      try {
        const taskId = BigInt(step.task_id);
        logTaskTimeline("timeout_detected", {
          taskId: step.task_id,
          stepIdx: step.step_idx,
          state: step.state,
          deadline: step.deadline,
        });
        if (step.state === StepState.RunningExternal) {
          await deps.timeoutExternalStep([taskId, step.step_idx]);
        } else if (step.state === StepState.AwaitingRating) {
          await deps.timeoutRating([taskId, step.step_idx]);
        } else if (step.state === StepState.RunningNative) {
          await deps.timeoutNativeStep([taskId, step.step_idx]);
        }
      } catch (error) {
        if (isNotTimedOutError(error)) {
          await deps.clearStepDeadline(step.task_id, step.step_idx);
        }
        deps.logger.warn(
          `[timeouts] step timeout skipped task=${step.task_id} step=${step.step_idx}: ${String(error)}`,
        );
      }
    }

    const nextTaskId = await deps.readNextTaskId();
    for (let taskId = 1n; taskId <= nextTaskId; taskId++) {
      const taskIdStr = taskId.toString();
      try {
        const raw = await deps.readTask(taskId);
        const deadline = Number(raw[5]);
        const state = Number(raw[6]);
        if (state === TaskState.Running && deadline > 0 && deadline <= now) {
          logTaskTimeline("task_timeout_detected", {
            taskId: taskIdStr,
            deadline,
          });
          await deps.timeoutTask([taskId]);
        }
      } catch (error) {
        deps.logger.warn(
          `[timeouts] task timeout skipped task=${taskIdStr}: ${String(error)}`,
        );
      }
    }
  }

  async function poll(): Promise<void> {
    while (running) {
      try {
        await tick();
      } catch (error) {
        deps.logger.error("[timeouts] error:", error);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNotTimedOutError(error: unknown): boolean {
  return String(error).includes("NotTimedOut()");
}

const defaultTimeoutKeeper = createTimeoutKeeper();

export function startTimeoutKeeper(): void {
  defaultTimeoutKeeper.start();
}
