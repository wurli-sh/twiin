import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  createPlanRouter,
  type PlanRouterDeps,
} from "./routes/plan";
import {
  createTasksRouter,
  type TasksRouterDeps,
} from "./routes/tasks";
import {
  createStreamRouter,
  type StreamRouterDeps,
} from "./routes/stream";
import {
  createAgentsRouter,
  type AgentsRouterDeps,
} from "./routes/agents";
import { isUpstreamAvailabilityError, upstreamUnavailableMessage } from "./errors";

export type AppDeps = {
  plan?: Partial<PlanRouterDeps>;
  tasks?: Partial<TasksRouterDeps>;
  stream?: Partial<StreamRouterDeps>;
  agents?: Partial<AgentsRouterDeps>;
};

export function createApp(deps: AppDeps = {}): Hono {
  const app = new Hono();

  app.use("*", cors({ origin: "*" }));

  app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));

  app.route("/api/plan", createPlanRouter(deps.plan));
  app.route("/api/tasks", createTasksRouter(deps.tasks));
  app.route("/api/stream", createStreamRouter(deps.stream));
  app.route("/api/agents", createAgentsRouter(deps.agents));

  app.onError((err, c) => {
    if (isUpstreamAvailabilityError(err)) {
      console.warn("[server] upstream unavailable:", err);
      return c.json({ error: upstreamUnavailableMessage(err) }, 503);
    }
    console.error("[server] unhandled error:", err);
    return c.json({ error: "internal server error" }, 500);
  });

  return app;
}
