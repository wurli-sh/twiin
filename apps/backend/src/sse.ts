import type { Context } from "hono";

type SseConn = { write: (data: string) => void; close: () => void };

const subscribers = new Map<string, Set<SseConn>>();

export function subscribe(taskId: string, conn: SseConn): () => void {
  if (!subscribers.has(taskId)) subscribers.set(taskId, new Set());
  subscribers.get(taskId)!.add(conn);
  return () => {
    subscribers.get(taskId)?.delete(conn);
    if (subscribers.get(taskId)?.size === 0) subscribers.delete(taskId);
  };
}

export function publish(taskId: string, type: string, data: unknown): void {
  const conns = subscribers.get(taskId);
  if (!conns || conns.size === 0) return;
  const msg = `event: ${type}\ndata: ${JSON.stringify(data, bigintReplacer)}\n\n`;
  for (const conn of conns) {
    try {
      conn.write(msg);
    } catch {
      conns.delete(conn);
    }
  }
}

export function publishAll(type: string, data: unknown): void {
  for (const taskId of subscribers.keys()) publish(taskId, type, data);
}

function bigintReplacer(_: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}

export function sseHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

export function makeSseStream(
  c: Context,
  taskId: string,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let unsub: (() => void) | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const conn: SseConn = {
        write(data) {
          controller.enqueue(encoder.encode(data));
        },
        close() {
          controller.close();
        },
      };
      unsub = subscribe(taskId, conn);
      // heartbeat every 15 s to prevent proxy timeouts
      timer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          // Client disconnected without triggering cancel() — clean up both
          if (timer) clearInterval(timer);
          if (unsub) {
            unsub();
            unsub = null;
          }
        }
      }, 15_000);
    },
    cancel() {
      if (unsub) unsub();
      if (timer) clearInterval(timer);
    },
  });
}
