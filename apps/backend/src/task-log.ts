type TimelineDetails = Record<string, unknown>;

const VERBOSE = new Set([
  "task_steps_read",
  "indexer_logs",
  "indexer_tick",
  "relay_step_detected",
  "relay_step_chain_fallback",
  "relay_step_chain_fallback_post",
  "relay_step_not_ready",
  "relay_step_skipped",
  "relay_dedup_stale_cleared",
  "relay_retry",
  "relay_job_reactivated",
  "rater_finalizing",
  "task_read",
  "task_completion_read",
  "stream_unsubscribed",
  "timeout_detected",
  "task_timeout_detected",
  "relay_indexer_lag",
]);

function format(kind: string, d: TimelineDetails): string {
  switch (kind) {
    case "api":
      return `${d.route} agent=${d.personalAgentId} budget=${d.budgetWei} "${String(d.goalPreview ?? "").slice(0, 80)}"`;
    case "plan_timing":
      return `${d.phase} ${d.ms}ms${d.source ? ` source=${d.source}` : ""}${d.goalPreview ? ` "${String(d.goalPreview).slice(0, 60)}"` : ""}`;
    case "plan_substitution":
      return `sub idx=${d.stepIdx} ${d.from}→${d.to} reason="${String(d.reason ?? "").slice(0, 60)}"`;
    case "plan_ready":
      return `${d.stepCount} steps est=${d.estimatedCostWei} source=${d.source} agent=${d.personalAgentId}`;
    case "task_event":
      return `${d.eventType} task=${d.taskId} id=${d.eventId}`;
    case "relay_submitting_result":
      return `submit task=${d.taskId} step=${d.stepIdx} config=${d.configId} bytes=${d.resultBytes}`;
    case "relay_result_submitted":
      return `submitted task=${d.taskId} step=${d.stepIdx} config=${d.configId}`;
    case "relay_exhausted":
      return `exhausted task=${d.taskId} step=${d.stepIdx} config=${d.configId}`;
    case "relay_step_expired":
      return `expired task=${d.taskId} step=${d.stepIdx}`;
    case "rater_scored":
      return `score task=${d.taskId} step=${d.stepIdx} score=${d.score}`;
    case "rater_finalized":
      return `finalized task=${d.taskId} step=${d.stepIdx} score=${d.score} ok=${d.approved}`;
    case "step_consensus_reached":
      return `consensus task=${d.taskId} step=${d.stepIdx} validators=${d.validators}`;
    case "stream_subscribed":
      return `sub task=${d.taskId} subs=${d.subscriberCount}`;
    default:
      return `${kind} ${Object.entries(d).map(([k, v]) => `${k}=${v}`).join(" ")}`;
  }
}

function emit(kind: string, details: TimelineDetails): void {
  if (VERBOSE.has(kind)) return;
  console.log(`[task] ${format(kind, details)}`);
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
