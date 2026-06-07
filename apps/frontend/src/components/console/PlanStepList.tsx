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
import { consolePageTheme } from '@/lib/execution-mode-theme'
import { ConsensusBadge } from '@/components/console/ConsensusBadge'
import type { TaskStep } from '@/hooks/useTaskDetail'
import { cn } from '@/lib/cn'

type Props = {
  steps: PlanStep[]
  stepProgress?: (index: number) => StepProgress
  chainSteps?: TaskStep[]
  executionMode?: ExecutionMode
  compact?: boolean
}

function StepIcon({
  progress,
  accentClass,
  compact,
}: {
  progress?: StepProgress
  accentClass: string
  compact?: boolean
}) {
  const size = compact ? 10 : 12
  if (progress === 'loading') {
    return <Loader2 size={size} className={cn('animate-spin', accentClass)} />
  }
  if (progress === 'done') {
    return <Check size={size} className={accentClass} strokeWidth={2.5} />
  }
  if (progress === 'error') {
    return <X size={size} className="text-destructive" strokeWidth={2.5} />
  }
  return (
    <span
      className={cn(
        'rounded-full border border-muted-foreground/40',
        compact ? 'size-1.5' : 'size-2',
      )}
    />
  )
}

function SubAgentBadge({
  label,
  configId,
  lane,
  accentClass,
  nativeBadgeClass,
  compact,
}: {
  label: string
  configId: number
  lane?: 'SomniaNative' | 'ExternalHTTP'
  accentClass: string
  nativeBadgeClass: string
  compact?: boolean
}) {
  const isExternal = lane === 'ExternalHTTP'

  return (
    <span
      className={cn(
        'inline-flex flex-wrap items-center',
        compact ? 'gap-0.5 text-[10px] leading-none' : 'gap-1.5 text-xs',
      )}
    >
      <span className={cn('font-medium', accentClass)}>{label}</span>
      <span className="text-muted-foreground">· config #{configId}</span>
      {lane && (
        <span
          className={cn(
            'inline-flex items-center gap-0.5 border font-semibold uppercase tracking-wide',
            compact ? 'px-0.5 py-px text-[9px]' : 'px-1 py-px text-[10px]',
            isExternal
              ? 'border-warning/40 bg-warning/10 text-warning-foreground'
              : nativeBadgeClass,
          )}
        >
          {isExternal ? <Globe size={compact ? 8 : 9} /> : <Server size={compact ? 8 : 9} />}
          {isExternal ? 'External' : 'Native'}
        </span>
      )}
    </span>
  )
}

export function PlanStepList({
  steps,
  stepProgress,
  chainSteps,
  executionMode: _executionMode = 'claude',
  compact,
}: Props) {
  void _executionMode
  const modeTheme = consolePageTheme()
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
        const chainStep = chainSteps?.find((s) => s.stepIdx === i)

        return (
          <li
            key={i}
            className={cn(
              'flex items-start border-b border-border/60 py-2 last:border-0',
              compact ? 'gap-1.5 py-0.5' : 'gap-2.5',
              loading && cn('border-l-2 pl-2', modeTheme.progressActiveBg),
            )}
          >
            <div
              className={cn(
                'flex shrink-0 items-center justify-center',
                compact ? 'size-3' : 'mt-0.5 size-4',
              )}
            >
              <StepIcon progress={progress} accentClass={modeTheme.icon} compact={compact} />
            </div>
            <div className={cn('min-w-0 flex-1', compact ? 'space-y-0' : 'space-y-0.5')}>
              <p
                className={cn(
                  'font-medium leading-tight',
                  compact ? 'text-xs' : 'text-sm',
                  done && 'text-muted-foreground',
                  loading && 'text-foreground',
                  !done && !loading && 'text-foreground',
                )}
              >
                <span className="text-muted-foreground">{i + 1}.</span> {title}
              </p>
              <div
                className={cn(
                  'flex flex-wrap items-center',
                  compact ? 'gap-0.5 text-[10px] leading-none' : 'gap-1.5',
                )}
              >
                <SubAgentBadge
                  label={subAgent.label}
                  configId={subAgent.configId}
                  lane={subAgent.lane}
                  accentClass={modeTheme.text}
                  nativeBadgeClass={modeTheme.badge}
                  compact={compact}
                />
                {chainStep?.consensusValidators ? (
                  <ConsensusBadge
                    validators={chainStep.consensusValidators}
                    medianCostWei={chainStep.consensusMedianCostWei}
                    compact={compact}
                  />
                ) : null}
              </div>
              {taskDetail && (
                <p
                  className={cn(
                    'truncate leading-snug text-muted-foreground',
                    compact ? 'text-[9px]' : 'text-xs',
                  )}
                >
                  {taskDetail}
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
