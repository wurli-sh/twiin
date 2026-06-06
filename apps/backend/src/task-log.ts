type TimelineDetails = Record<string, unknown>;

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, current) =>
    typeof current === "bigint" ? current.toString() : current,
  );
}

function emit(kind: string, details: TimelineDetails): void {
  console.log(
    `[timeline] ${serialize({
      ts: new Date().toISOString(),
      kind,
      ...details,
    })}`,
  );
}

export function logTaskTimeline(
  event: string,
  details: TimelineDetails,
): void {
  emit(event, details);
}

export function logTaskApi(
  route: string,
  details: TimelineDetails,
): void {
  emit("api", { route, ...details });
}
