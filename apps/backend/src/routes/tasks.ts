import { Hono } from "hono";
import { TaskState } from "@twiin/shared";
import { orchestratorContract, addresses, defaultStartBlock } from "../contracts";
import { publicClient } from "../clients";
import { getStepsForTask, getTaskMeta } from "../db";
import { logTaskApi, logTaskTimeline } from "../task-log";
import {
  fetchTaskCompletion,
  type TaskCompletion,
} from "../task-completion";

export type TasksRouterDeps = {
  readTask: (taskId: bigint) => Promise<
    readonly [number, bigint, number, bigint, bigint, bigint, number]
  >;
  getStepsForTask: (taskId: string) => ReturnType<typeof getStepsForTask>;
  getTaskMeta: (taskId: string) => ReturnType<typeof getTaskMeta>;
  fetchTaskCompletion: (
    taskId: bigint,
  ) => Promise<TaskCompletion | null>;
};

function bigintToStr(_: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}

export function createTasksRouter(
  overrides: Partial<TasksRouterDeps> = {},
): Hono {
  const deps: TasksRouterDeps = {
    readTask: (taskId) => orchestratorContract.read.tasks([taskId]),
    getStepsForTask,
    getTaskMeta,
    fetchTaskCompletion: (taskId) =>
      fetchTaskCompletion(
        publicClient,
        addresses.orchestrator,
        taskId,
        defaultStartBlock,
      ),
    ...overrides,
  };
  const router = new Hono();

  router.get("/:taskId", async (c) => {
    const taskId = c.req.param("taskId");
    if (!/^[0-9]+$/.test(taskId)) {
      return c.json({ error: "invalid taskId" }, 400);
    }
    logTaskApi("/api/tasks/:taskId", { taskId });

    let task: {
      mode: number;
      personalAgentId: bigint;
      cursor: number;
      budgetWei: bigint;
      spentWei: bigint;
      deadline: bigint;
      state: number;
    };

    try {
      const raw = await deps.readTask(BigInt(taskId));
      task = {
        mode: raw[0],
        personalAgentId: raw[1],
        cursor: raw[2],
        budgetWei: raw[3],
        spentWei: raw[4],
        deadline: raw[5],
        state: raw[6],
      };
    } catch (e) {
      console.error("[tasks] chain read failed:", e);
      return c.json({ error: "task not found" }, 404);
    }

    const stateName = TaskState[task.state] ?? "Unknown";
    let taskMeta: Awaited<ReturnType<typeof deps.getTaskMeta>> = null;
    try {
      taskMeta = await deps.getTaskMeta(taskId);
    } catch (error) {
      console.warn(`[tasks] metadata lookup failed task=${taskId}: ${String(error)}`);
    }
    logTaskTimeline("task_read", {
      taskId,
      state: task.state,
      stateName,
      cursor: task.cursor,
      spentWei: task.spentWei,
      budgetWei: task.budgetWei,
      lastAbortReason: taskMeta?.last_abort_reason ?? null,
    });

    return new Response(
      JSON.stringify(
        {
          taskId,
          mode: task.mode,
          personalAgentId: task.personalAgentId,
          cursor: task.cursor,
          budgetWei: task.budgetWei,
          spentWei: task.spentWei,
          deadline: task.deadline,
          state: task.state,
          stateName,
          lastAbortReason: taskMeta?.last_abort_reason ?? null,
        },
        bigintToStr,
      ),
      { headers: { "Content-Type": "application/json" } },
    );
  });

  router.get("/:taskId/steps", async (c) => {
    const taskId = c.req.param("taskId");
    if (!/^[0-9]+$/.test(taskId)) {
      return c.json({ error: "invalid taskId" }, 400);
    }

    const steps = await deps.getStepsForTask(taskId);
    if (steps.length > 0) {
      logTaskTimeline("task_steps_read", {
        taskId,
        stepCount: steps.length,
        steps: steps.map((step) => ({
          stepIdx: step.step_idx,
          configId: step.config_id,
          state: step.state,
          deadline: step.deadline,
        })),
      });
    }
    return c.json({ taskId, steps });
  });

  router.get("/:taskId/completion", async (c) => {
    const taskId = c.req.param("taskId");
    if (!/^[0-9]+$/.test(taskId)) {
      return c.json({ error: "invalid taskId" }, 400);
    }

    let state: number;
    try {
      const raw = await deps.readTask(BigInt(taskId));
      state = raw[6];
    } catch (e) {
      console.error("[tasks] chain read failed:", e);
      return c.json({ error: "task not found" }, 404);
    }

    if (state !== TaskState.Completed) {
      return c.json(
        { error: "task not completed", state, stateName: TaskState[state] ?? "Unknown" },
        404,
      );
    }

    const completion = await deps.fetchTaskCompletion(BigInt(taskId));
    if (!completion) {
      return c.json({ error: "completion log not found" }, 404);
    }
    logTaskTimeline("task_completion_read", {
      taskId,
      blockNumber: completion.blockNumber,
      transactionHash: completion.transactionHash,
    });

    return c.json({ taskId, ...completion });
  });

  return router;
}
