import { Globe, Loader2, Check, X, Server } from 'lucide-react'
import {
  describePlanStep,
  planStepTaskDetail,
  resolveSubAgentRef,
} from '@/lib/plan-step-display'
import { useSubAgents } from '@/hooks/useSubAgents'
import type { PlanStep } from '@/lib/plan-api'
import type { StepProgress } from '@/lib/console-session'
import type { ExecutionMode } from '@/config/features'
import { executionModeTheme } from '@/lib/execution-mode-theme'
import { cn } from '@/lib/cn'

type Props = {
  steps: PlanStep[]
  stepProgress?: (index: number) => StepProgress
  executionMode?: ExecutionMode
  compact?: boolean
}

function StepIcon({
  progress,
  accentClass,
}: {
  progress?: StepProgress
  accentClass: string
}) {
  if (progress === 'loading') {
    return <Loader2 size={12} className={cn('animate-spin', accentClass)} />
  }
  if (progress === 'done') {
    return <Check size={12} className={accentClass} strokeWidth={2.5} />
  }
  if (progress === 'error') {
    return <X size={12} className="text-destructive" strokeWidth={2.5} />
  }
  return <span className="size-2 rounded-full border border-muted-foreground/40" />
}

function SubAgentBadge({
  label,
  configId,
  lane,
  accentClass,
  nativeBadgeClass,
}: {
  label: string
  configId: number
  lane?: 'SomniaNative' | 'ExternalHTTP'
  accentClass: string
  nativeBadgeClass: string
}) {
  const isExternal = lane === 'ExternalHTTP'

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      <span className={cn('font-medium', accentClass)}>{label}</span>
      <span className="text-muted-foreground">· config #{configId}</span>
      {lane && (
        <span
          className={cn(
            'inline-flex items-center gap-0.5 border px-1 py-px text-[10px] font-semibold uppercase tracking-wide',
            isExternal
              ? 'border-warning/40 bg-warning/10 text-warning-foreground'
              : nativeBadgeClass,
          )}
        >
          {isExternal ? <Globe size={9} /> : <Server size={9} />}
          {isExternal ? 'External' : 'Native'}
        </span>
      )}
    </span>
  )
}

export function PlanStepList({
  steps,
  stepProgress,
  executionMode = 'claude',
  compact,
}: Props) {
  const modeTheme = executionModeTheme(executionMode)
  const { subAgents } = useSubAgents()

  return (
    <ol className={cn('space-y-0', compact ? 'space-y-0' : 'space-y-0.5')}>
      {steps.map((step, i) => {
        const { title, detail, agent } = describePlanStep(step, i, steps)
        const subAgent = resolveSubAgentRef(step.configId, subAgents)
        const taskDetail = planStepTaskDetail(detail, agent)
        const progress = stepProgress?.(i)
        const done = progress === 'done'
        const loading = progress === 'loading'

        return (
          <li
            key={i}
            className={cn(
              'flex items-start gap-2.5 border-b border-border/60 py-2 last:border-0',
              compact && 'py-1.5',
              loading && cn('border-l-2 pl-2', modeTheme.progressActiveBg),
            )}
          >
            <div className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
              <StepIcon progress={progress} accentClass={modeTheme.icon} />
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p
                className={cn(
                  'text-sm font-medium leading-tight',
                  done && 'text-muted-foreground',
                  loading && 'text-foreground',
                  !done && !loading && 'text-foreground',
                )}
              >
                <span className="text-muted-foreground">{i + 1}.</span> {title}
              </p>
              <SubAgentBadge
                label={subAgent.label}
                configId={subAgent.configId}
                lane={subAgent.lane}
                accentClass={modeTheme.text}
                nativeBadgeClass={modeTheme.badge}
              />
              {taskDetail && (
                <p className="truncate text-xs leading-snug text-muted-foreground">{taskDetail}</p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
