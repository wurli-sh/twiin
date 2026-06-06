import { Globe, Loader2, Check, X, Server } from 'lucide-react'
import {
  describePlanStep,
  planStepTaskDetail,
  resolveSubAgentRef,
} from '@/lib/plan-step-display'
import { useSubAgents } from '@/hooks/useSubAgents'
import type { PlanStep } from '@/lib/plan-api'
import type { StepProgress } from '@/lib/console-session'
import { cn } from '@/lib/cn'

type Props = {
  steps: PlanStep[]
  stepProgress?: (index: number) => StepProgress
  compact?: boolean
}

function StepIcon({ progress }: { progress?: StepProgress }) {
  if (progress === 'loading') {
    return <Loader2 size={12} className="animate-spin text-primary" />
  }
  if (progress === 'done') {
    return <Check size={12} className="text-primary" strokeWidth={2.5} />
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
}: {
  label: string
  configId: number
  lane?: 'SomniaNative' | 'ExternalHTTP'
}) {
  const isExternal = lane === 'ExternalHTTP'

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      <span className="font-medium text-primary">{label}</span>
      <span className="text-muted-foreground">· config #{configId}</span>
      {lane && (
        <span
          className={cn(
            'inline-flex items-center gap-0.5 border px-1 py-px text-[10px] font-semibold uppercase tracking-wide',
            isExternal
              ? 'border-warning/40 bg-warning/10 text-warning-foreground'
              : 'border-primary/20 bg-primary-bright/15 text-primary',
          )}
        >
          {isExternal ? <Globe size={9} /> : <Server size={9} />}
          {isExternal ? 'External' : 'Native'}
        </span>
      )}
    </span>
  )
}

export function PlanStepList({ steps, stepProgress, compact }: Props) {
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
              loading && 'border-l-2 border-l-primary-bright bg-primary-bright/10 pl-2',
            )}
          >
            <div className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
              <StepIcon progress={progress} />
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
