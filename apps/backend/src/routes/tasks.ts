import { Hono } from "hono";
import { TaskState } from "@twiin/shared";
import { orchestratorContract, addresses, defaultStartBlock } from "../contracts";
import { publicClient } from "../clients";
import { getStepsForTask } from "../db";
import {
  fetchTaskCompletion,
  type TaskCompletion,
} from "../task-completion";

export type TasksRouterDeps = {
  readTask: (taskId: bigint) => Promise<
    readonly [number, bigint, number, bigint, bigint, bigint, number]
  >;
  getStepsForTask: (taskId: string) => ReturnType<typeof getStepsForTask>;
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

    return c.json({ taskId, ...completion });
  });

  return router;
}
