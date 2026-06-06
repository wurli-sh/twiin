import {
  deriveMacroPhases,
  deriveStepProgress,
  getActivePlan,
  getCurrentTurnEntries,
  isTrustlessTurn,
  type SessionEntry,
  type PhaseState,
} from '@/lib/console-session'
import { PlanStepList } from './PlanStepList'
import type { TaskStep } from '@/hooks/useTaskDetail'
import { cn } from '@/lib/cn'
import { Check, Loader2 } from 'lucide-react'

type Props = {
  entries: SessionEntry[]
  chainSteps: TaskStep[]
  chainTaskState?: number
  activeExecutionTaskId?: string | null
  hookTaskId?: string | null
  trustless?: boolean
}

const MACRO_LABELS: { key: keyof ReturnType<typeof deriveMacroPhases>; label: string }[] = [
  { key: 'goal', label: 'Goal' },
  { key: 'plan', label: 'Plan' },
  { key: 'approve', label: 'Approve' },
  { key: 'execute', label: 'Run' },
  { key: 'complete', label: 'Done' },
]

function MacroDot({ state }: { state: PhaseState }) {
  if (state === 'done') {
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-foreground text-background">
        <Check size={11} strokeWidth={3} />
      </span>
    )
  }
  if (state === 'loading' || state === 'active') {
    return (
      <span className="flex size-5 items-center justify-center rounded-full border border-primary bg-primary-bright/20">
        <Loader2 size={11} className="animate-spin text-primary" />
      </span>
    )
  }
  if (state === 'error') {
    return <span className="size-5 rounded-full border-2 border-destructive bg-destructive/10" />
  }
  return <span className="size-5 rounded-full border border-muted-foreground/30" />
}

function labelClass(state: PhaseState): string {
  if (state === 'done') return 'text-muted-foreground'
  if (state === 'loading' || state === 'active') {
    return 'font-semibold text-primary'
  }
  if (state === 'error') return 'font-medium text-destructive'
  return 'text-muted-foreground/60'
}

export function TaskProgressBar({
  entries,
  chainSteps,
  chainTaskState,
  activeExecutionTaskId,
  hookTaskId,
  trustless: trustlessProp,
}: Props) {
  const turn = getCurrentTurnEntries(entries)
  const trustless = trustlessProp ?? isTrustlessTurn(entries)
  const phases = deriveMacroPhases(turn, chainTaskState, { trustless })
  const macroLabels = trustless
    ? MACRO_LABELS.map((item) =>
        item.key === 'plan'
          ? { ...item, label: 'Preflight' }
          : item.key === 'approve'
            ? { ...item, label: 'Submit' }
            : item,
      )
    : MACRO_LABELS
  const planEntry = getActivePlan(turn)
  const stepsMatchExecution =
    activeExecutionTaskId != null &&
    hookTaskId != null &&
    hookTaskId === activeExecutionTaskId
  const stepsForBar = stepsMatchExecution ? chainSteps : []
  const showSteps =
    (planEntry || trustless) && phases.execute !== 'pending'

  return (
    <div className="sticky top-0 z-20 border-b border-border bg-background/95 px-3 py-2.5 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-1">
        {macroLabels.map(({ key, label }, i) => {
          const state = phases[key]
          const done = state === 'done'
          const active = state === 'loading' || state === 'active'
          return (
            <div key={key} className="flex min-w-0 flex-1 items-center gap-1.5">
              <MacroDot state={state} />
              <span
                className={cn(
                  'truncate text-sm font-medium',
                  labelClass(state),
                  active && 'bg-primary-bright/10 px-1.5 py-0.5',
                )}
              >
                {label}
              </span>
              {i < macroLabels.length - 1 && (
                <div
                  className={cn(
                    'mx-0.5 h-px flex-1',
                    done ? 'bg-primary-bright/40' : 'bg-border',
                  )}
                />
              )}
            </div>
          )
        })}
      </div>

      {showSteps && planEntry && (
        <div className="mt-2.5 border-t border-border/80 pt-2.5">
          <PlanStepList
            steps={planEntry.plan.steps}
            compact
            stepProgress={(i) => {
              const chain = stepsForBar.find((s) => s.stepIdx === i)
              return chain ? deriveStepProgress(chain.state) : 'pending'
            }}
          />
        </div>
      )}
    </div>
  )
}
