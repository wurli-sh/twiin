import { useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { PlanApproval } from './PlanApproval'
import { PlanBudgetRecovery, type PlanBudgetMismatch } from './PlanBudgetRecovery'
import { TaskProgressBar } from './TaskProgressBar'
import { TaskResultCard } from './TaskResultCard'
import { AgentStatusLine } from './AgentStatusLine'
import { TaskState } from '@/config/contracts'
import {
  type SessionEntry,
  getCurrentTurnExecution,
  getPlanForExecution,
} from '@/lib/console-session'
import { resolveExecutionPhase } from '@/lib/agent-status-copy'
import type { TwiinAgentInfo } from '@/hooks/useTwiinAgents'
import type { StreamEvent } from '@/hooks/useTaskStream'
import type { ChainTask, TaskStep } from '@/hooks/useTaskDetail'

type Props = {
  sessionEntries: SessionEntry[]
  agent: TwiinAgentInfo | undefined
  isApproving: boolean
  planMismatch: PlanBudgetMismatch | null
  isRaisingCaps: boolean
  activeTaskId: string | null
  events: StreamEvent[]
  connected: boolean
  chainTask: ChainTask | null | undefined
  chainSteps: TaskStep[]
  onApprove: (planEntryId: string) => Promise<void>
  onReject: (planEntryId: string, reason: 'user' | 'expired') => void
  onSetBudgetAndRetry: (b: string) => void
  onRaiseCapsAndRetry: (e: number) => void
  onDismissMismatch: () => void
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="mb-3 flex justify-end"
    >
      <div className="max-w-[82%] rounded-lg rounded-br-sm bg-charcoal px-3 py-2 text-sm leading-relaxed text-white">
        {children}
      </div>
    </motion.div>
  )
}

function AgentBlock({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="mb-3 space-y-1.5"
    >
      {children}
    </motion.div>
  )
}

export function TranscriptPanel({
  sessionEntries,
  agent,
  isApproving,
  planMismatch,
  isRaisingCaps,
  activeTaskId,
  events,
  connected,
  chainTask,
  chainSteps,
  onApprove,
  onReject,
  onSetBudgetAndRetry,
  onRaiseCapsAndRetry,
  onDismissMismatch,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const activeExecutionId = sessionEntries.findLast((e) => e.kind === 'execution')?.id
  const currentTurnExecution = getCurrentTurnExecution(sessionEntries)

  useEffect(() => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
  }, [sessionEntries.length, activeTaskId, events.length, isApproving])

  return (
    <div className="flex-1 overflow-y-auto scrollbar-custom">
      {sessionEntries.length > 0 && (
        <TaskProgressBar
          entries={sessionEntries}
          chainSteps={chainSteps}
          chainTaskState={chainTask?.state}
          activeExecutionTaskId={currentTurnExecution?.taskId}
          hookTaskId={activeTaskId}
        />
      )}

      <div className="mx-auto max-w-5xl px-3 pt-1.5 pb-3 sm:px-4">
        {sessionEntries.map((entry, index) => {
          const prevEntry = index > 0 ? sessionEntries[index - 1] : null
          const showTurnDivider = entry.kind === 'user' && prevEntry?.kind === 'result'

          if (entry.kind === 'user') {
            return (
              <div key={entry.id}>
                {showTurnDivider && (
                  <div className="my-4 flex items-center gap-2" aria-hidden>
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground/60">
                      New task
                    </span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                )}
                <UserBubble>
                  <p className="whitespace-pre-wrap">{entry.text}</p>
                  <p className="mt-0.5 text-xs text-white/45">{entry.budgetStt} STT</p>
                </UserBubble>
              </div>
            )
          }

          if (entry.kind === 'status') {
            return (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mb-3"
              >
                <AgentStatusLine phase={entry.phase} />
              </motion.div>
            )
          }

          if (entry.kind === 'plan' && agent) {
            return (
              <AgentBlock key={entry.id}>
                <PlanApproval
                  plan={entry.plan}
                  goal={entry.goal}
                  agent={agent}
                  status={entry.status}
                  onApprove={() => onApprove(entry.id)}
                  onReject={(reason) => onReject(entry.id, reason)}
                  isSubmitting={isApproving && entry.status === 'pending'}
                />
              </AgentBlock>
            )
          }

          if (entry.kind === 'execution') {
            const isActive = entry.id === activeExecutionId && entry.taskId === activeTaskId
            const isRunning = isActive && chainTask?.state === TaskState.Running

            if (!isActive || chainTask?.state === TaskState.Completed) return null

            const planEntry = getPlanForExecution(sessionEntries, entry.taskId)
            const phase = resolveExecutionPhase({
              isApproving,
              connected,
              eventsCount: events.length,
              chainSteps,
              chainTaskState: chainTask?.state,
            })

            return (
              <AgentBlock key={entry.id}>
                <AgentStatusLine
                  phase={isRunning ? phase : 'dispatching'}
                  planSteps={planEntry?.plan.steps}
                  chainSteps={chainSteps}
                  taskId={entry.taskId}
                  showTaskId
                />
              </AgentBlock>
            )
          }

          if (entry.kind === 'result') {
            return (
              <AgentBlock key={entry.id}>
                <TaskResultCard
                  text={entry.text}
                  spent={entry.spent}
                  budget={entry.budget}
                  aborted={entry.aborted}
                  taskId={entry.taskId}
                />
              </AgentBlock>
            )
          }

          if (entry.kind === 'error') {
            return (
              <AgentBlock key={entry.id}>
                <div className="max-w-[92%] border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {entry.text}
                </div>
              </AgentBlock>
            )
          }

          return null
        })}

        {isApproving && !sessionEntries.some((e) => e.kind === 'execution') && (
          <AgentBlock>
            <AgentStatusLine phase="signing" />
          </AgentBlock>
        )}

        {planMismatch && agent && (
          <AgentBlock>
            <PlanBudgetRecovery
              agent={agent}
              mismatch={planMismatch}
              isRaisingCaps={isRaisingCaps}
              onSetBudgetAndRetry={onSetBudgetAndRetry}
              onRaiseCapsAndRetry={onRaiseCapsAndRetry}
              onDismiss={onDismissMismatch}
            />
          </AgentBlock>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}
