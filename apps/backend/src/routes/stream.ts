import { Hono } from "hono";
import { makeSseStream, sseHeaders } from "../sse";

export type StreamRouterDeps = {
  makeSseStream: typeof makeSseStream;
  sseHeaders: typeof sseHeaders;
};

export function createStreamRouter(
  overrides: Partial<StreamRouterDeps> = {},
): Hono {
  const deps: StreamRouterDeps = {
    makeSseStream,
    sseHeaders,
    ...overrides,
  };
  const router = new Hono();

  router.get("/:taskId", (c) => {
    const taskId = c.req.param("taskId");
    if (!/^[0-9]+$/.test(taskId)) {
      return c.json({ error: "invalid taskId" }, 400);
    }

    const stream = deps.makeSseStream(c, taskId, c.req.header("last-event-id"));
    return new Response(stream, { headers: deps.sseHeaders() });
  });

  return router;
}
