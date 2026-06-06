import type { StreamEvent } from '@/hooks/useTaskStream'
import { STREAM_EVENT_LABELS } from '@/hooks/useTaskStream'

type Props = {
  event: StreamEvent
}

function formatTrustlessEvent(event: StreamEvent): string {
  const label = STREAM_EVENT_LABELS[event.type] ?? event.type
  const data = event.data

  if (event.type === 'janice_iteration') {
    const iteration = data.iteration ?? data.iterations
    const reason = data.finishReason ?? data.finish_reason
    return `${label} #${iteration}${reason ? ` (${reason})` : ''}`
  }
  if (event.type === 'janice_tool_executed') {
    const tool = data.toolName ?? data.tool_name
    const ok = data.success
    return `${label}: ${tool}${ok === false ? ' (failed)' : ''}`
  }
  if (event.type === 'trustless_step_appended') {
    const step = data.stepIdx ?? data.step_idx
    return `${label} — step ${step}`
  }
  if (event.type === 'janice_resume_queued') {
    const reason = data.reason
    return `${label}${reason ? `: ${reason}` : ''}`
  }
  if (event.type === 'trustless_intent') {
    const goal = data.goal
    return goal ? `${label}: ${String(goal).slice(0, 120)}` : label
  }
  return label
}

export function TrustlessEventLine({ event }: Props) {
  return (
    <div className="max-w-[92%] border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-mono text-[10px] uppercase tracking-wide text-primary">
        Trustless
      </span>
      <p className="mt-0.5 text-sm text-foreground">{formatTrustlessEvent(event)}</p>
    </div>
  )
}
