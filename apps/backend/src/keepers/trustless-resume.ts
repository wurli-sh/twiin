import {
  buildTrustlessResumePayload,
  NativeConfigId,
  TaskState,
  TrustlessAwaiting,
  type TrustlessStepInput,
  type TrustlessTurnInput,
} from "@twiin/shared";
import { publicClient } from "../clients";
import { deployment, orchestratorContract, agentRegistryContract } from "../contracts";
import {
  getStepsForTask,
  listTrustlessTasksAwaitingJanice,
  listTrustlessTasksAwaitingResume,
  patchTrustlessTask,
  listTrustlessTurns,
} from "../db";
import { logTaskTimeline } from "../task-log";
import { computeJaniceCostWei } from "../trustless";

const POLL_MS = 5_000;
const JANICE_STUCK_AFTER_MS = 30_000;

const AgentsApiAbi = [
  {
    type: "function",
    name: "getRequestDeposit",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

type ResumeDeps = {
  listTrustlessTasksAwaitingJanice: typeof listTrustlessTasksAwaitingJanice;
  listTrustlessTasksAwaitingResume: typeof listTrustlessTasksAwaitingResume;
  listTrustlessTurns: typeof listTrustlessTurns;
  getStepsForTask: typeof getStepsForTask;
  patchTrustlessTask: typeof patchTrustlessTask;
  readTask: (
    taskId: bigint,
  ) => Promise<readonly [number, bigint, number, bigint, bigint, bigint, number]>;
  readTrustlessContext: (
    taskId: bigint,
  ) => Promise<readonly [bigint, number, number, number, bigint, `0x${string}`]>;
  readJaniceCost: () => Promise<bigint>;
  resumeTrustlessTask: (
    args: readonly [bigint, `0x${string}`, bigint],
  ) => Promise<unknown>;
  logger: Pick<Console, "log" | "warn" | "error">;
};

export function createTrustlessResumeKeeper(
  overrides: Partial<ResumeDeps> = {},
) {
  const deps: ResumeDeps = {
    listTrustlessTasksAwaitingJanice,
    listTrustlessTasksAwaitingResume,
    listTrustlessTurns,
    getStepsForTask,
    patchTrustlessTask,
    readTask: (taskId) => orchestratorContract.read.tasks([taskId]),
    readTrustlessContext: (taskId) => orchestratorContract.read.trustlessCtx([taskId]),
    readJaniceCost: async () => {
      const requestDeposit = await publicClient.readContract({
        address: deployment.agentsApi as `0x${string}`,
        abi: AgentsApiAbi,
        functionName: "getRequestDeposit",
      });
      const janice = await agentRegistryContract.read.get([BigInt(NativeConfigId.JANICE)]);
      return computeJaniceCostWei(requestDeposit, janice.costWei);
    },
    resumeTrustlessTask: (args) =>
      orchestratorContract.write.resumeTrustlessTask(args),
    logger: console,
    ...overrides,
  };

  let running = false;

  async function scanJaniceStalls(): Promise<void> {
    const tasks = await deps.listTrustlessTasksAwaitingJanice();
    if (tasks.length === 0) return;
    const now = Date.now();

    for (const task of tasks) {
      const taskId = task.task_id;
      try {
        const chainTask = await deps.readTask(BigInt(taskId));
        const deadline = Number(chainTask[5]);
        const state = Number(chainTask[6]);
        if (state !== TaskState.Running) {
          await deps.patchTrustlessTask(taskId, {
            awaiting: TrustlessAwaiting.Done,
            lastResumeReason: "janice_watch_stopped_task_not_running",
          });
          continue;
        }

        const trustlessCtx = await deps.readTrustlessContext(BigInt(taskId));
        const chainAwaiting = Number(trustlessCtx[3]);
        const chainIterations = Number(trustlessCtx[1]);
        const chainMaxIterations = Number(trustlessCtx[2]);
        const chainRequestId = trustlessCtx[4]?.toString?.() ?? null;

        if (chainAwaiting !== TrustlessAwaiting.Janice) {
          await deps.patchTrustlessTask(taskId, {
            awaiting:
              chainAwaiting >= TrustlessAwaiting.Janice &&
                chainAwaiting <= TrustlessAwaiting.Done
                ? chainAwaiting
                : TrustlessAwaiting.Done,
            janiceRequestId: chainRequestId,
            lastResumeReason: "janice_watch_chain_not_awaiting_janice",
          });
          continue;
        }

        const ageMs = Math.max(0, now - task.updated_at * 1000);
        if (ageMs < JANICE_STUCK_AFTER_MS) continue;

        await deps.patchTrustlessTask(taskId, {
          janiceRequestId: chainRequestId,
          lastResumeReason: "janice_callback_stuck",
        });
        logTaskTimeline("trustless_janice_stuck", {
          taskId,
          chainIterations,
          chainMaxIterations,
          chainRequestId,
          ageMs,
          taskDeadline: deadline,
          note: "No JaniceIteration observed after trustless_janice_pending; upstream Somnia Agents callback may be stalled.",
        });
      } catch (error) {
        logTaskTimeline("trustless_janice_watch_error", {
          taskId,
          error: String(error),
        });
        deps.logger.warn(
          `[trustless-resume] janice watch skipped task=${taskId}: ${String(error)}`,
        );
      }
    }
  }

  async function tick(): Promise<void> {
    await scanJaniceStalls();

    const tasks = await deps.listTrustlessTasksAwaitingResume();
    if (tasks.length === 0) return;
    const janiceCostWei = await deps.readJaniceCost();
    logTaskTimeline("trustless_resume_scan", {
      taskCount: tasks.length,
      janiceCostWei: janiceCostWei.toString(),
    });

    for (const task of tasks) {
      const taskId = task.task_id;
      try {
        const chainTask = await deps.readTask(BigInt(taskId));
        const deadline = Number(chainTask[5]);
        const state = Number(chainTask[6]);
        const now = Math.floor(Date.now() / 1000);
        logTaskTimeline("trustless_resume_task_scan", {
          taskId,
          dbAwaiting: task.awaiting,
          dbIterations: task.iterations,
          dbMaxIterations: task.max_iterations,
          lastResumeReason: task.last_resume_reason,
          chainState: state,
          deadline,
          now,
        });
        if (state !== TaskState.Running) {
          await deps.patchTrustlessTask(taskId, {
            awaiting: TrustlessAwaiting.Done,
            lastResumeReason: "resume_stopped_task_not_running",
          });
          logTaskTimeline("trustless_resume_skip", {
            taskId,
            reason: "task_not_running",
            chainState: state,
          });
          continue;
        }
        if (deadline > 0 && deadline <= now) {
          await deps.patchTrustlessTask(taskId, {
            awaiting: TrustlessAwaiting.Done,
            lastResumeReason: "resume_stopped_task_deadline_elapsed",
          });
          logTaskTimeline("trustless_resume_skip", {
            taskId,
            reason: "task_deadline_elapsed",
            deadline,
            now,
          });
          continue;
        }
        const trustlessCtx = await deps.readTrustlessContext(BigInt(taskId));
        const chainAwaiting = Number(trustlessCtx[3]);
        const chainIterations = Number(trustlessCtx[1]);
        const chainMaxIterations = Number(trustlessCtx[2]);
        if (chainAwaiting !== TrustlessAwaiting.Resume) {
          await deps.patchTrustlessTask(taskId, {
            awaiting:
              chainAwaiting >= TrustlessAwaiting.Janice &&
                chainAwaiting <= TrustlessAwaiting.Done
                ? chainAwaiting
                : TrustlessAwaiting.Done,
            lastResumeReason: "resume_stopped_chain_not_awaiting_resume",
          });
          logTaskTimeline("trustless_resume_skip", {
            taskId,
            reason: "chain_not_awaiting_resume",
            chainAwaiting,
            chainIterations,
            chainMaxIterations,
          });
          continue;
        }
        if (chainIterations >= chainMaxIterations) {
          await deps.patchTrustlessTask(taskId, {
            awaiting: TrustlessAwaiting.Done,
            lastResumeReason: "resume_stopped_max_iterations_reached",
          });
          logTaskTimeline("trustless_resume_skip", {
            taskId,
            reason: "max_iterations_reached",
            chainIterations,
            chainMaxIterations,
          });
          continue;
        }

        const turns = (await deps.listTrustlessTurns(taskId)).map<TrustlessTurnInput>(
          (turn) => ({
            iteration: turn.iteration,
            finishReason: turn.finish_reason,
            assistantMessage: turn.assistant_message,
            ...safeParseTurnContext(turn.tool_calls_json),
          }),
        );
        const steps = (await deps.getStepsForTask(taskId)).map<TrustlessStepInput>(
          (step) => ({
            stepIdx: step.step_idx,
            state: step.state,
            payload: step.payload,
            resultHex: step.result_hex,
            score: step.score,
          }),
        );
        logTaskTimeline("trustless_resume_build", {
          taskId,
          turnCount: turns.length,
          stepCount: steps.length,
          chainIterations,
          chainMaxIterations,
          lastTurnFinishReason: turns.at(-1)?.finishReason ?? null,
          stepStates: steps.map((step) => ({
            stepIdx: step.stepIdx,
            state: step.state,
            score: step.score,
            hasResult: step.resultHex != null,
          })),
        });

        const resumePayload = buildTrustlessResumePayload({
          goal: task.goal,
          turns,
          steps,
        });
        logTaskTimeline("trustless_resume_submitting", {
          taskId,
          payloadBytes: (resumePayload.length - 2) / 2,
          janiceCostWei: janiceCostWei.toString(),
        });
        await deps.resumeTrustlessTask([
          BigInt(taskId),
          resumePayload,
          janiceCostWei,
        ]);
        logTaskTimeline("trustless_resume_submitted", {
          taskId,
          chainIterations,
          chainMaxIterations,
        });
      } catch (error) {
        if (isBudgetExhaustedError(error)) {
          await deps.patchTrustlessTask(taskId, {
            awaiting: TrustlessAwaiting.Done,
            lastResumeReason: "resume_budget_exhausted",
          });
        }
        logTaskTimeline("trustless_resume_error", {
          taskId,
          error: String(error),
        });
        deps.logger.warn(
          `[trustless-resume] resume skipped task=${taskId}: ${String(error)}`,
        );
      }
    }
  }

  async function poll(): Promise<void> {
    while (running) {
      try {
        await tick();
      } catch (error) {
        deps.logger.error("[trustless-resume] error:", error);
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

function isBudgetExhaustedError(error: unknown): boolean {
  return String(error).includes("BudgetExhausted()");
}

function safeParseTurnContext(raw: string): Pick<
  TrustlessTurnInput,
  "toolCalls" | "updatedRoles" | "updatedMessages" | "pendingToolCallIds"
> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return {
        toolCalls: parsed.flatMap((item) => parseToolCall(item)),
      };
    }
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const toolCalls = Array.isArray(record.toolCalls)
        ? record.toolCalls.flatMap((item) => parseToolCall(item))
        : [];
      return {
        toolCalls,
        updatedRoles: stringArray(record.updatedRoles),
        updatedMessages: stringArray(record.updatedMessages),
        pendingToolCallIds: stringArray(record.pendingToolCallIds),
      };
    }
    return { toolCalls: [] };
  } catch {
    return { toolCalls: [] };
  }
}

function parseToolCall(
  item: unknown,
): Array<{ toolName: string; args: `0x${string}` }> {
  if (
    item &&
    typeof item === "object" &&
    "toolName" in item &&
    typeof item.toolName === "string" &&
    "args" in item &&
    typeof item.args === "string"
  ) {
    return [{ toolName: item.toolName, args: item.args as `0x${string}` }];
  }
  return [];
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const defaultTrustlessResumeKeeper = createTrustlessResumeKeeper();

export function startTrustlessResumeKeeper(): void {
  defaultTrustlessResumeKeeper.start();
}
