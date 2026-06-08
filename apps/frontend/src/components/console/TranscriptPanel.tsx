import { useCallback, useEffect, useMemo, useRef } from 'react'
import { motion } from 'framer-motion'
import { PlanApproval } from './PlanApproval'
import { PlanBudgetRecovery, type PlanBudgetMismatch } from './PlanBudgetRecovery'
import { TaskResultCard } from './TaskResultCard'
import { ReportPendingCard } from './ReportPendingCard'
import { AgentStatusLine } from './AgentStatusLine'
import { consolePageTheme } from '@/lib/execution-mode-theme'
import { cn } from '@/lib/cn'
import { TaskState } from '@/config/contracts'
import {
  type SessionEntry,
  getCurrentTurnExecution,
  getPlanForExecution,
} from '@/lib/console-session'
import { resolveExecutionPhase } from '@/lib/agent-status-copy'
import { configIdLabel } from '@/lib/config-names'
import { extractPublishFeedParams } from '@/lib/publish-feed-params'
import { usePublishFeed } from '@/hooks/usePublishFeed'
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

function UserBubble({ text, budgetStt }: { text: string; budgetStt: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="mb-3 flex justify-end"
    >
      <div className="max-w-[82%] rounded-lg rounded-br-sm bg-charcoal px-3 py-2 text-sm leading-relaxed text-white">
        <p className="whitespace-pre-wrap">{text}</p>
        <p className="mt-0.5 text-xs text-white/45">{budgetStt} STT</p>
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
  const modeTheme = consolePageTheme()
  const { publishFeed, isPublishing } = usePublishFeed()
  const bottomRef = useRef<HTMLDivElement>(null)
  const activeExecutionId = sessionEntries.findLast((e) => e.kind === 'execution')?.id
  const currentTurnExecution = getCurrentTurnExecution(sessionEntries)
  const rejectionEvents = events.filter(
    (ev) =>
      ev.type === 'step_rejected' ||
      (ev.type === 'step_rated' && ev.data.approved === false),
  )
  const pendingReportTaskId =
    activeTaskId &&
    currentTurnExecution?.taskId === activeTaskId &&
    chainTask?.state === TaskState.Completed &&
    !sessionEntries.some((e) => e.kind === 'result' && e.taskId === activeTaskId)
      ? activeTaskId
      : null

  const publishParams = useMemo(
    () =>
      chainTask?.state === TaskState.Completed
        ? extractPublishFeedParams(chainSteps)
        : null,
    [chainSteps, chainTask?.state],
  )

  const handlePublishFeed = useCallback(async () => {
    if (!agent || !publishParams) return
    await publishFeed(BigInt(agent.id), publishParams)
  }, [agent, publishFeed, publishParams])

  useEffect(() => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
  }, [sessionEntries.length, activeTaskId, events.length, isApproving])

  return (
    <div className={cn('flex-1 overflow-y-auto scrollbar-custom', modeTheme.transcript)}>
      <div className="mx-auto max-w-3xl px-3 pt-1.5 pb-3 sm:px-4">
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
                <UserBubble text={entry.text} budgetStt={entry.budgetStt} />
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
                <AgentStatusLine
                  phase={entry.phase}
                  accentClass={modeTheme.statusSpinner}
                  shimmerClass={modeTheme.text}
                />
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
                  executionMode="claude"
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

            const isTerminal =
              chainTask?.state === TaskState.Completed ||
              chainTask?.state === TaskState.Aborted
            const hasResult = sessionEntries.some(
              (e) => e.kind === 'result' && e.taskId === entry.taskId,
            )
            if (!isActive || isTerminal || hasResult) return null

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
                  accentClass={modeTheme.statusSpinner}
                  shimmerClass={modeTheme.text}
                />
              </AgentBlock>
            )
          }

          if (entry.kind === 'result') {
            const showPublish =
              !entry.aborted &&
              entry.taskId === activeTaskId &&
              publishParams != null &&
              agent != null
            return (
              <AgentBlock key={entry.id}>
                <TaskResultCard
                  text={entry.text}
                  spent={entry.spent}
                  budget={entry.budget}
                  aborted={entry.aborted}
                  abortDetail={entry.abortDetail}
                  taskId={entry.taskId}
                  publishLabel={
                    showPublish
                      ? `Publish to feed (${publishParams.confidence}% confidence)`
                      : undefined
                  }
                  onPublish={showPublish ? () => void handlePublishFeed() : undefined}
                  isPublishing={isPublishing}
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

        {rejectionEvents.map((ev) => {
          const stepIdx = typeof ev.data.stepIdx === 'number' ? ev.data.stepIdx : null
          const score = typeof ev.data.score === 'number' ? ev.data.score : null
          const reason = typeof ev.data.reason === 'string' ? ev.data.reason : null
          const step = stepIdx != null ? chainSteps.find((s) => s.stepIdx === stepIdx) : null
          const agentName = step ? configIdLabel(Number(step.configId)) : null
          return (
            <AgentBlock key={`reject-ev-${ev.id}`}>
              <div className="max-w-[92%] rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <p className="font-semibold">
                  Step rejected
                  {stepIdx != null ? ` · step ${stepIdx + 1}` : ''}
                  {agentName ? ` · ${agentName}` : ''}
                </p>
                {score != null && (
                  <p className="mt-1 tabular-nums">
                    Score {score}/100 <span className="text-destructive/70">(min 40)</span>
                  </p>
                )}
                {reason && <p className="mt-1 text-destructive/80">{reason}</p>}
              </div>
            </AgentBlock>
          )
        })}

        {pendingReportTaskId && (
          <AgentBlock>
            <ReportPendingCard taskId={pendingReportTaskId} />
          </AgentBlock>
        )}

        {isApproving && !sessionEntries.some((e) => e.kind === 'execution') && (
          <AgentBlock>
            <AgentStatusLine
              phase="signing"
              accentClass={modeTheme.statusSpinner}
              shimmerClass={modeTheme.text}
            />
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
