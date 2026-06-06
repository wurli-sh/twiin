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
  listTrustlessTasksAwaitingResume,
  listTrustlessTurns,
} from "../db";
import { computeJaniceCostWei } from "../trustless";

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
    listTrustlessTasksAwaitingResume,
    listTrustlessTurns,
    getStepsForTask,
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
        const trustlessCtx = await deps.readTrustlessContext(BigInt(task.task_id));
        const chainAwaiting = Number(trustlessCtx[3]);
        const chainIterations = Number(trustlessCtx[1]);
        const chainMaxIterations = Number(trustlessCtx[2]);
        if (chainAwaiting !== TrustlessAwaiting.Resume) continue;
        if (chainIterations >= chainMaxIterations) continue;

        const turns = (await deps.listTrustlessTurns(task.task_id)).map<TrustlessTurnInput>(
          (turn) => ({
            iteration: turn.iteration,
            finishReason: turn.finish_reason,
            assistantMessage: turn.assistant_message,
            ...safeParseTurnContext(turn.tool_calls_json),
          }),
        );
        const steps = (await deps.getStepsForTask(task.task_id)).map<TrustlessStepInput>(
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
