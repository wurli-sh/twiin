import {
  deriveMacroPhases,
  deriveStepProgress,
  getActivePlan,
  getCurrentTurnEntries,
  type SessionEntry,
  type PhaseState,
} from '@/lib/console-session'
import { PlanStepList } from './PlanStepList'
import type { ExecutionMode } from '@/config/features'
import { executionModeTheme } from '@/lib/execution-mode-theme'
import type { TaskStep } from '@/hooks/useTaskDetail'
import { cn } from '@/lib/cn'
import { Check, Loader2 } from 'lucide-react'

type Props = {
  entries: SessionEntry[]
  chainSteps: TaskStep[]
  chainTaskState?: number
  activeExecutionTaskId?: string | null
  hookTaskId?: string | null
  executionMode?: ExecutionMode
  trustless?: boolean
}

const MACRO_LABELS: { key: keyof ReturnType<typeof deriveMacroPhases>; label: string }[] = [
  { key: 'goal', label: 'Goal' },
  { key: 'plan', label: 'Plan' },
  { key: 'approve', label: 'Approve' },
  { key: 'execute', label: 'Run' },
  { key: 'complete', label: 'Done' },
]

function MacroDot({
  state,
  trustless,
}: {
  state: PhaseState
  trustless: boolean
}) {
  const activeClass = trustless ? 'mode-trustless-dot-active' : 'mode-claude-dot-active'

  if (state === 'done') {
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-foreground text-background">
        <Check size={11} strokeWidth={3} />
      </span>
    )
  }
  if (state === 'loading' || state === 'active') {
    return (
      <span
        className={cn(
          'flex size-5 items-center justify-center rounded-full border',
          activeClass,
        )}
      >
        <Loader2 size={11} className="animate-spin" />
      </span>
    )
  }
  if (state === 'error') {
    return <span className="size-5 rounded-full border-2 border-destructive bg-destructive/10" />
  }
  return <span className="size-5 rounded-full border border-muted-foreground/30" />
}

function labelClass(state: PhaseState, trustless: boolean): string {
  if (state === 'done') return 'text-muted-foreground'
  if (state === 'loading' || state === 'active') {
    return trustless
      ? 'font-semibold mode-trustless-text'
      : 'font-semibold mode-claude-text'
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
  executionMode = 'claude',
}: Props) {
  const modeTheme = executionModeTheme(executionMode)
  const turn = getCurrentTurnEntries(entries)
  const trustless = executionMode === 'trustless'
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
    <div
      className={cn(
        'sticky top-0 z-20 border-b px-3 py-2.5 backdrop-blur-sm',
        modeTheme.progressBar,
      )}
    >
      <div className="flex items-center justify-between gap-1">
        {macroLabels.map(({ key, label }, i) => {
          const state = phases[key]
          const done = state === 'done'
          const active = state === 'loading' || state === 'active'
          return (
            <div key={key} className="flex min-w-0 flex-1 items-center gap-1.5">
              <MacroDot state={state} trustless={trustless} />
              <span
                className={cn(
                  'truncate text-sm font-medium',
                  labelClass(state, trustless),
                  active && cn(modeTheme.progressActiveBg, 'px-1.5 py-0.5'),
                )}
              >
                {label}
              </span>
              {i < macroLabels.length - 1 && (
                <div
                  className={cn(
                    'mx-0.5 h-px flex-1',
                    done ? modeTheme.progressConnector : 'bg-border',
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
            executionMode={executionMode}
            compact
            stepProgress={(i) => {
              const chain = stepsForBar.find((s) => s.stepIdx === i)
              return chain ? deriveStepProgress(chain.state) : 'pending'
            }}
          />
        </div>
      )}

      {showSteps && trustless && !planEntry && stepsForBar.length > 0 && (
        <div className="mt-2.5 border-t border-border/80 pt-2.5">
          <PlanStepList
            steps={stepsForBar.map((step) => ({
              configId: Number(step.configId),
              payload: step.payload,
              maxCostWei: '0',
              timeoutSeconds: 300,
            }))}
            executionMode={executionMode}
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
