import { useMemo } from 'react'
import { TextShimmer } from '@/components/ui/TextShimmer'
import { ThinkingSpinner } from '@/components/ui/ThinkingSpinner'
import {
  buildExecutionPhrases,
  getStatusPhrases,
  type AgentStatusPhase,
} from '@/lib/agent-status-copy'
import type { PlanStep } from '@/lib/plan-api'
import type { TaskStep } from '@/hooks/useTaskDetail'
import { useRotatingPhrase } from '@/hooks/useRotatingPhrase'
import { cn } from '@/lib/cn'

type Props = {
  phase: AgentStatusPhase
  planSteps?: PlanStep[]
  chainSteps?: TaskStep[]
  taskId?: string
  showTaskId?: boolean
  accentClass?: string
  shimmerClass?: string
}

export function AgentStatusLine({
  phase,
  planSteps,
  chainSteps = [],
  taskId,
  showTaskId = false,
  accentClass = 'text-primary',
  shimmerClass = 'text-primary/90',
}: Props) {
  const phrases = useMemo(() => {
    if (planSteps && chainSteps.length > 0) {
      return buildExecutionPhrases(phase, planSteps, chainSteps)
    }
    return getStatusPhrases(phase)
  }, [phase, planSteps, chainSteps])

  const phrase = useRotatingPhrase(phrases)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ThinkingSpinner className={cn('size-4 shrink-0', accentClass)} />
      <TextShimmer className={cn('text-sm', shimmerClass)} active>
        {phrase}
      </TextShimmer>
      {showTaskId && taskId && (
        <span className="text-xs text-muted-foreground">Task #{taskId}</span>
      )}
    </div>
  )
}
