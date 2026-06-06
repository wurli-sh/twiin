import { NativeConfigId, TaskState } from "@twiin/shared";
import { publicClient } from "../clients";
import { deployment, orchestratorContract, agentRegistryContract } from "../contracts";
import {
  getStepsForTask,
  listTrustlessTasksAwaitingResume,
  listTrustlessTurns,
} from "../db";
import {
  buildTrustlessResumePayload,
  computeJaniceCostWei,
  type TrustlessStepRecord,
  type TrustlessTurnRecord,
} from "../trustless";

const POLL_MS = 5_000;

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
  listTrustlessTasksAwaitingResume: typeof listTrustlessTasksAwaitingResume;
  listTrustlessTurns: typeof listTrustlessTurns;
  getStepsForTask: typeof getStepsForTask;
  readTask: (
    taskId: bigint,
  ) => Promise<readonly [number, bigint, number, bigint, bigint, bigint, number]>;
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
    listTrustlessTasksAwaitingResume,
    listTrustlessTurns,
    getStepsForTask,
    readTask: (taskId) => orchestratorContract.read.tasks([taskId]),
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

  async function tick(): Promise<void> {
    const tasks = await deps.listTrustlessTasksAwaitingResume();
    if (tasks.length === 0) return;
    const janiceCostWei = await deps.readJaniceCost();

    for (const task of tasks) {
      try {
        const chainTask = await deps.readTask(BigInt(task.task_id));
        const deadline = Number(chainTask[5]);
        const state = Number(chainTask[6]);
        if (state !== TaskState.Running) continue;
        if (deadline > 0 && deadline <= Math.floor(Date.now() / 1000)) continue;
        if (task.iterations >= task.max_iterations) continue;

        const turns = (await deps.listTrustlessTurns(task.task_id)).map<TrustlessTurnRecord>(
          (turn) => ({
            iteration: turn.iteration,
            finishReason: turn.finish_reason,
            assistantMessage: turn.assistant_message,
            toolCalls: safeParseToolCalls(turn.tool_calls_json),
          }),
        );
        const steps = (await deps.getStepsForTask(task.task_id)).map<TrustlessStepRecord>(
          (step) => ({
            stepIdx: step.step_idx,
            state: step.state,
            payload: step.payload,
            resultHex: step.result_hex,
            score: step.score,
          }),
        );

        const resumePayload = buildTrustlessResumePayload({
          goal: task.goal,
          turns,
          steps,
          maxIterations: task.max_iterations,
        });
        await deps.resumeTrustlessTask([
          BigInt(task.task_id),
          resumePayload,
          janiceCostWei,
        ]);
      } catch (error) {
        deps.logger.warn(
          `[trustless-resume] resume skipped task=${task.task_id}: ${String(error)}`,
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

function safeParseToolCalls(
  raw: string,
): Array<{ toolName: string; args: `0x${string}` }> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
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
    });
  } catch {
    return [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const defaultTrustlessResumeKeeper = createTrustlessResumeKeeper();

export function startTrustlessResumeKeeper(): void {
  defaultTrustlessResumeKeeper.start();
}
