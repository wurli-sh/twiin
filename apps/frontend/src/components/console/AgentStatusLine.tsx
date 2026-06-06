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

type Props = {
  phase: AgentStatusPhase
  planSteps?: PlanStep[]
  chainSteps?: TaskStep[]
  taskId?: string
  showTaskId?: boolean
}

export function AgentStatusLine({
  phase,
  planSteps,
  chainSteps = [],
  taskId,
  showTaskId = false,
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
      <ThinkingSpinner className="size-4 shrink-0 text-primary" />
      <TextShimmer className="text-sm text-primary/90" active>
        {phrase}
      </TextShimmer>
      {showTaskId && taskId && (
        <span className="text-xs text-muted-foreground">Task #{taskId}</span>
      )}
    </div>
  )
}
