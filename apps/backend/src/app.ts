import { Hono } from "hono";
import { cors } from "hono/cors";
import { planRouter } from "./routes/plan";
import { tasksRouter } from "./routes/tasks";
import { streamRouter } from "./routes/stream";

export function createApp(): Hono {
  const app = new Hono();

  app.use("*", cors({ origin: "*" }));

  app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));

  app.route("/api/plan", planRouter);
  app.route("/api/tasks", tasksRouter);
  app.route("/api/stream", streamRouter);

  app.onError((err, c) => {
    console.error("[server] unhandled error:", err);
    return c.json({ error: "internal server error" }, 500);
  });

  return app;
}
