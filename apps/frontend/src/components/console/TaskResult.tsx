import { hexToString } from 'viem'
import { CheckCircle2, Star, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { TaskState } from '@/config/contracts'
import {
  stepStateLabel,
  stepStateVariant,
  taskStateLabel,
  taskStateVariant,
} from '@/lib/task-state'
import { configIdLabel } from '@/lib/config-names'
import type { ChainTask, TaskStep } from '@/hooks/useTaskDetail'

function decodeResult(hex: string | null): string {
  if (!hex || hex === '0x') return ''
  try {
    return hexToString(hex as `0x${string}`)
  } catch {
    return ''
  }
}

type TaskResultProps = {
  task: ChainTask | null
  steps: TaskStep[]
}

export function TaskResult({ task, steps }: TaskResultProps) {
  if (!task) return null

  const isComplete = task.state === TaskState.Completed
  const isAborted = task.state === TaskState.Aborted

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between border-b border-border bg-surface-alt/60 px-4 py-3">
        <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-text-faint">
          {isComplete ? (
            <CheckCircle2 size={13} className="text-success" />
          ) : isAborted ? (
            <XCircle size={13} className="text-danger" />
          ) : null}
          Result · chain state
        </span>
        <Badge variant={taskStateVariant(task.state)}>{taskStateLabel(task.state)}</Badge>
      </div>

      <div className="grid grid-cols-3 gap-2 p-4">
        <Stat label="Budget" value={`${Number(task.budget).toFixed(3)} STT`} />
        <Stat label="Spent" value={`${Number(task.spent).toFixed(3)} STT`} />
        <Stat label="Steps" value={`${task.cursor}/${steps.length || '—'}`} />
      </div>

      {steps.length > 0 && (
        <ul className="divide-y divide-border/40 border-t border-border/40">
          {steps.map((step) => {
            const result = decodeResult(step.resultHex)
            return (
              <li key={step.stepIdx} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-text">
                    {step.stepIdx + 1}. {configIdLabel(Number(step.configId))}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {step.score != null && (
                      <Badge variant="default">
                        <Star size={9} className="mr-1 inline" />
                        {step.score}/100
                      </Badge>
                    )}
                    <Badge variant={stepStateVariant(step.state)}>
                      {stepStateLabel(step.state)}
                    </Badge>
                  </div>
                </div>
                {result && (
                  <p className="mt-1.5 whitespace-pre-wrap wrap-break-word rounded-lg bg-surface-alt/60 px-3 py-2 text-[11px] text-text-muted">
                    {result.length > 400 ? `${result.slice(0, 400)}…` : result}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <p className="border-t border-border/40 px-4 py-2 text-[10px] text-text-faint">
        Task state read from AgentOrchestrator on-chain · steps from indexer (advisory)
      </p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-alt px-3 py-2 text-center">
      <p className="text-[9px] uppercase tracking-wider text-text-faint">{label}</p>
      <p className="mt-0.5 text-xs font-bold tabular-nums text-text">{value}</p>
    </div>
  )
}
