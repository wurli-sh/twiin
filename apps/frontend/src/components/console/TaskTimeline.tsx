import { motion } from 'framer-motion'
import { Activity, Radio } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { TaskState } from '@/config/contracts'
import { streamEventLabel, type StreamEvent } from '@/hooks/useTaskStream'
import { stepStateLabel, taskStateLabel, taskStateVariant } from '@/lib/task-state'
import { cn } from '@/lib/cn'

type TaskTimelineProps = {
  taskId: string
  events: StreamEvent[]
  connected: boolean
  /** On-chain task state — overrides misleading "Live" SSE badge when terminal. */
  taskState?: number | null
}

function formatEventDetail(type: string, data: Record<string, unknown>): string {
  if (type === 'step_state' && data.state != null) {
    return `step ${String(data.stepIdx ?? '?')} → ${stepStateLabel(Number(data.state))}`
  }
  if (type === 'task_completed' && data.result) {
    const r = String(data.result)
    return r.length > 120 ? `${r.slice(0, 120)}…` : r
  }
  if (type === 'task_aborted' && data.reason) {
    return String(data.reason)
  }
  if (data.stepIdx != null) {
    return `step ${String(data.stepIdx)}`
  }
  return ''
}

export function TaskTimeline({ taskId, events, connected, taskState }: TaskTimelineProps) {
  const isTerminal =
    taskState === TaskState.Completed || taskState === TaskState.Aborted
  const isRunning = taskState === TaskState.Running

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between border-b border-border bg-surface-alt/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-primary" />
          <span className="text-xs font-medium uppercase tracking-widest text-text-faint">
            Task #{taskId}
          </span>
        </div>
        {isTerminal && taskState != null ? (
          <Badge variant={taskStateVariant(taskState)}>{taskStateLabel(taskState)}</Badge>
        ) : (
          <span
            className={cn(
              'inline-flex items-center gap-1 text-[10px] font-bold uppercase',
              connected && isRunning ? 'text-success' : 'text-text-faint',
            )}
          >
            <Radio size={10} className={connected && isRunning ? 'animate-pulse' : ''} />
            {connected ? 'Stream on' : 'Connecting…'}
          </span>
        )}
      </div>

      <div className="max-h-80 overflow-y-auto p-3">
        {events.length === 0 ? (
          <p className="py-8 text-center text-xs leading-relaxed text-text-faint">
            {taskState === TaskState.Aborted ? (
              <>
                Task aborted on-chain before any events were indexed.
                {connected
                  ? ' The indexer did not record any step events for this task. This can happen if the step failed quickly or the backend was not indexing at the time.'
                  : ' Reconnecting to event stream…'}
              </>
            ) : taskState === TaskState.Completed ? (
              'Task completed on-chain. No live events were recorded.'
            ) : (
              'Waiting for keeper events…'
            )}
          </p>
        ) : (
          <ul className="space-y-2">
            {events.map((ev) => (
              <motion.li
                key={`${ev.id}-${ev.type}`}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                className="rounded-lg border border-border/60 bg-surface-alt/50 px-3 py-2"
              >
                <p className="text-xs font-bold text-text">{streamEventLabel(ev.type)}</p>
                {formatEventDetail(ev.type, ev.data) && (
                  <p className="mt-0.5 text-[11px] text-text-muted">
                    {formatEventDetail(ev.type, ev.data)}
                  </p>
                )}
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
