import type { Context } from "hono";
import { logTaskTimeline } from "./task-log";

type SseConn = { write: (data: string) => void; close: () => void };
type SseEvent = {
  id: number;
  taskId: string;
  type: string;
  data: unknown;
};

const subscribers = new Map<string, Set<SseConn>>();
const history = new Map<string, SseEvent[]>();
const nextEventIds = new Map<string, number>();
const MAX_HISTORY = 200;

export function subscribe(taskId: string, conn: SseConn): () => void {
  if (!subscribers.has(taskId)) subscribers.set(taskId, new Set());
  subscribers.get(taskId)!.add(conn);
  logTaskTimeline("stream_subscribed", {
    taskId,
    subscriberCount: subscribers.get(taskId)?.size ?? 0,
  });
  return () => {
    subscribers.get(taskId)?.delete(conn);
    logTaskTimeline("stream_unsubscribed", {
      taskId,
      subscriberCount: subscribers.get(taskId)?.size ?? 0,
    });
    if (subscribers.get(taskId)?.size === 0) subscribers.delete(taskId);
  };
}

export function publish(taskId: string, type: string, data: unknown): void {
  const id = (nextEventIds.get(taskId) ?? 0) + 1;
  nextEventIds.set(taskId, id);
  const event = { id, taskId, type, data };
  pushHistory(event);
  logTaskTimeline("task_event", {
    taskId,
    eventType: type,
    eventId: id,
    data,
  });

  const conns = subscribers.get(taskId);
  if (!conns || conns.size === 0) return;
  const msg = formatEvent(event);
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

function formatEvent(event: SseEvent): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data, bigintReplacer)}\n\n`;
}

function pushHistory(event: SseEvent): void {
  const events = history.get(event.taskId) ?? [];
  events.push(event);
  if (events.length > MAX_HISTORY) events.splice(0, events.length - MAX_HISTORY);
  history.set(event.taskId, events);
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
  lastEventId?: string | null,
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
      replayMissedEvents(controller, encoder, taskId, lastEventId);
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

function replayMissedEvents(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: { encode: (input?: string) => Uint8Array },
  taskId: string,
  lastEventId?: string | null,
): void {
  const sinceId = Number(lastEventId ?? "");
  const events = history.get(taskId) ?? [];
  for (const event of events) {
    // Fresh clients (no Last-Event-ID) receive full in-memory history.
    if (!Number.isFinite(sinceId) || sinceId <= 0 || event.id > sinceId) {
      controller.enqueue(encoder.encode(formatEvent(event)));
    }
  }
}
