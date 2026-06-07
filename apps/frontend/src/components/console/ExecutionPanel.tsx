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
import { consolePageTheme } from '@/lib/execution-mode-theme'
import type { TaskStep } from '@/hooks/useTaskDetail'
import { cn } from '@/lib/cn'
import { Check, Loader2, X } from 'lucide-react'

export type ExecutionPanelProps = {
  entries: SessionEntry[]
  chainSteps: TaskStep[]
  chainTaskState?: number
  activeExecutionTaskId?: string | null
  hookTaskId?: string | null
  executionMode?: ExecutionMode
  onClose?: () => void
}

const MACRO_LABELS: { key: keyof ReturnType<typeof deriveMacroPhases>; label: string }[] = [
  { key: 'goal', label: 'Goal' },
  { key: 'plan', label: 'Plan' },
  { key: 'approve', label: 'Approve' },
  { key: 'execute', label: 'Run' },
  { key: 'complete', label: 'Done' },
]

function MacroDot({ state }: { state: PhaseState }) {
  const activeClass = 'mode-trustless-dot-active'

  if (state === 'done') {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
        <Check size={9} strokeWidth={3} />
      </span>
    )
  }
  if (state === 'loading' || state === 'active') {
    return (
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-full border',
          activeClass,
        )}
      >
        <Loader2 size={9} className="animate-spin" />
      </span>
    )
  }
  if (state === 'error') {
    return (
      <span className="size-4 shrink-0 rounded-full border-2 border-destructive bg-destructive/10" />
    )
  }
  return <span className="size-4 shrink-0 rounded-full border border-muted-foreground/30" />
}

function labelClass(state: PhaseState): string {
  if (state === 'done') return 'text-muted-foreground'
  if (state === 'loading' || state === 'active') {
    return 'font-semibold mode-trustless-text'
  }
  if (state === 'error') return 'font-medium text-destructive'
  return 'text-muted-foreground/60'
}

export function getExecutionStepSummary(
  entries: SessionEntry[],
  chainSteps: TaskStep[],
  activeExecutionTaskId?: string | null,
  hookTaskId?: string | null,
): { done: number; total: number } | null {
  const turn = getCurrentTurnEntries(entries)
  const planEntry = getActivePlan(turn)
  const stepsMatchExecution =
    activeExecutionTaskId != null &&
    hookTaskId != null &&
    hookTaskId === activeExecutionTaskId
  const stepsForBar = stepsMatchExecution ? chainSteps : []

  const total = planEntry?.plan.steps.length ?? stepsForBar.length
  if (total === 0) return null

  const done = stepsForBar.filter(
    (s) => deriveStepProgress(s.state) === 'done',
  ).length

  return { done, total }
}

export function ExecutionPanel({
  entries,
  chainSteps,
  chainTaskState,
  activeExecutionTaskId,
  hookTaskId,
  executionMode = 'claude',
  onClose,
}: ExecutionPanelProps) {
  const modeTheme = consolePageTheme()
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
  const stepSummary = getExecutionStepSummary(
    entries,
    chainSteps,
    activeExecutionTaskId,
    hookTaskId,
  )

  const stepProgressFn = (i: number) => {
    const chain = stepsForBar.find((s) => s.stepIdx === i)
    return chain ? deriveStepProgress(chain.state) : 'pending'
  }

  return (
    <div className={cn('flex h-full flex-col', modeTheme.progressBar)}>
      <div className="shrink-0 border-b border-border/80 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Execution
          </p>
          <div className="flex items-center gap-1.5">
            {stepSummary && phases.execute !== 'pending' && (
              <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
                {stepSummary.done}/{stepSummary.total} done
              </span>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
                aria-label="Close"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="shrink-0 px-3 py-2">
        <ol className="space-y-1">
          {macroLabels.map(({ key, label }) => {
            const state = phases[key]
            const active = state === 'loading' || state === 'active'
            return (
              <li key={key} className="flex items-center gap-2">
                <MacroDot state={state} />
                <span
                  className={cn(
                    'text-xs font-medium leading-none',
                    labelClass(state),
                    active && cn(modeTheme.progressActiveBg, 'rounded px-1 py-px'),
                  )}
                >
                  {label}
                </span>
              </li>
            )
          })}
        </ol>
      </div>

      {showSteps && (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border/80 px-1 pt-1 scrollbar-custom">
          {planEntry && (
            <PlanStepList
              steps={planEntry.plan.steps}
              chainSteps={stepsForBar}
              executionMode={executionMode}
              compact
              stepProgress={stepProgressFn}
            />
          )}

          {trustless && !planEntry && stepsForBar.length > 0 && (
            <PlanStepList
              steps={stepsForBar.map((step) => ({
                configId: Number(step.configId),
                payload: step.payload,
                maxCostWei: '0',
                timeoutSeconds: 300,
              }))}
              chainSteps={stepsForBar}
              executionMode={executionMode}
              compact
              stepProgress={stepProgressFn}
            />
          )}
        </div>
      )}
    </div>
  )
}
