import { Hono } from "hono";
import { makeSseStream, sseHeaders } from "../sse";

export const streamRouter = new Hono();

streamRouter.get("/:taskId", (c) => {
  const taskId = c.req.param("taskId");
  if (!/^[0-9]+$/.test(taskId)) {
    return c.json({ error: "invalid taskId" }, 400);
  }

  const stream = makeSseStream(c, taskId);
  return new Response(stream, { headers: sseHeaders() });
});
