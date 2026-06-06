import { StepState, TaskState } from '@/config/contracts'
import type { AgentStatusPhase } from '@/lib/agent-status-copy'
import type { PlanResponse } from '@/lib/plan-api'
import type { TaskStep } from '@/hooks/useTaskDetail'
import type { StreamEvent } from '@/hooks/useTaskStream'

export type PlanStatus = 'pending' | 'approved' | 'rejected' | 'expired'

export type SessionEntry =
  | { id: string; kind: 'user'; text: string; budgetStt: string }
  | { id: string; kind: 'status'; phase: AgentStatusPhase }
  | { id: string; kind: 'plan'; goal: string; plan: PlanResponse; status: PlanStatus }
  | {
      id: string
      kind: 'trustless_preflight'
      goal: string
      minBudgetStt: string
      janiceCostStt: string
      maxIterations: number
      warnings: string[]
    }
  | { id: string; kind: 'execution'; taskId: string }
  | {
      id: string
      kind: 'result'
      taskId: string
      text: string
      spent?: string
      budget?: string
      aborted?: boolean
    }
  | { id: string; kind: 'error'; text: string }

export type MacroPhase = 'goal' | 'plan' | 'approve' | 'execute' | 'complete'
export type PhaseState = 'pending' | 'active' | 'done' | 'error' | 'loading'
export type StepProgress = 'pending' | 'loading' | 'done' | 'error'

export function createEntryId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function getCurrentTurnEntries(entries: SessionEntry[]): SessionEntry[] {
  let lastUserIdx = -1
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].kind === 'user') {
      lastUserIdx = i
      break
    }
  }
  if (lastUserIdx === -1) return entries
  return entries.slice(lastUserIdx)
}

export function getActivePlan(
  entries: SessionEntry[],
): (SessionEntry & { kind: 'plan' }) | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].kind === 'plan') return entries[i] as SessionEntry & { kind: 'plan' }
  }
  return null
}

export function getActiveExecution(
  entries: SessionEntry[],
): (SessionEntry & { kind: 'execution' }) | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].kind === 'execution') {
      return entries[i] as SessionEntry & { kind: 'execution' }
    }
  }
  return null
}

export function getLastUserGoal(entries: SessionEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry.kind === 'user') return entry.text
  }
  return null
}

export function getPlanForExecution(
  entries: SessionEntry[],
  taskId: string,
): (SessionEntry & { kind: 'plan' }) | null {
  const execIdx = entries.findIndex((e) => e.kind === 'execution' && e.taskId === taskId)
  if (execIdx === -1) return null

  let userIdx = -1
  for (let i = execIdx - 1; i >= 0; i--) {
    if (entries[i].kind === 'user') {
      userIdx = i
      break
    }
  }
  const turnStart = userIdx === -1 ? 0 : userIdx

  for (let i = execIdx - 1; i >= turnStart; i--) {
    if (entries[i].kind === 'plan') return entries[i] as SessionEntry & { kind: 'plan' }
  }
  return null
}

export function removeStatusEntriesForTurn(entries: SessionEntry[]): SessionEntry[] {
  const turnStatusIds = new Set(
    getCurrentTurnEntries(entries)
      .filter((e) => e.kind === 'status')
      .map((e) => e.id),
  )
  return entries.filter((e) => !(e.kind === 'status' && turnStatusIds.has(e.id)))
}

export function getPendingPlanForTurn(
  entries: SessionEntry[],
): (SessionEntry & { kind: 'plan' }) | null {
  const plan = getActivePlan(getCurrentTurnEntries(entries))
  return plan?.status === 'pending' ? plan : null
}

export function getCurrentTurnExecution(
  entries: SessionEntry[],
): (SessionEntry & { kind: 'execution' }) | null {
  const turn = getCurrentTurnEntries(entries)
  for (let i = turn.length - 1; i >= 0; i--) {
    if (turn[i].kind === 'execution') {
      return turn[i] as SessionEntry & { kind: 'execution' }
    }
  }
  return null
}

export function isTrustlessTurn(entries: SessionEntry[]): boolean {
  const turn = getCurrentTurnEntries(entries)
  return turn.some((e) => e.kind === 'trustless_preflight')
}

export function deriveMacroPhases(
  entries: SessionEntry[],
  chainTaskState?: number,
  options?: { trustless?: boolean },
): Record<MacroPhase, PhaseState> {
  const turn = getCurrentTurnEntries(entries)
  const trustless = options?.trustless ?? isTrustlessTurn(entries)
  const hasUser = turn.some((e) => e.kind === 'user')
  const isPlanning = turn.some((e) => e.kind === 'status' && e.phase === 'planning')
  const planEntry = getActivePlan(turn)
  const hasTrustlessPreflight = turn.some((e) => e.kind === 'trustless_preflight')
  const hasExecution = turn.some((e) => e.kind === 'execution')
  const hasResult = turn.some((e) => e.kind === 'result')

  let approve: PhaseState = 'pending'
  if (trustless && hasTrustlessPreflight) {
    approve = 'done'
  } else if (planEntry?.status === 'pending') approve = 'active'
  else if (planEntry?.status === 'approved') approve = 'done'
  else if (planEntry && (planEntry.status === 'rejected' || planEntry.status === 'expired')) {
    approve = 'error'
  }

  let plan: PhaseState = 'pending'
  if (trustless) {
    if (isPlanning) plan = 'loading'
    else if (hasTrustlessPreflight) plan = 'done'
    else if (hasUser) plan = 'active'
  } else if (isPlanning) plan = 'loading'
  else if (planEntry) plan = 'done'
  else if (hasUser) plan = 'active'

  let execute: PhaseState = 'pending'
  if (hasExecution && chainTaskState === TaskState.Running) execute = 'loading'
  else if (hasExecution && (chainTaskState === TaskState.Completed || hasResult)) {
    execute = 'done'
  } else if (hasExecution) execute = 'active'

  let complete: PhaseState = 'pending'
  if (hasResult) complete = 'done'
  else if (chainTaskState === TaskState.Aborted) complete = 'error'

  return {
    goal: hasUser ? 'done' : 'pending',
    plan,
    approve,
    execute,
    complete,
  }
}

export function deriveStepProgress(state: number): StepProgress {
  switch (state) {
    case StepState.Succeeded:
      return 'done'
    case StepState.Failed:
    case StepState.TimedOut:
      return 'error'
    case StepState.RunningNative:
    case StepState.RunningExternal:
    case StepState.AwaitingRating:
    case StepState.Retrying:
      return 'loading'
    default:
      return 'pending'
  }
}

export function mergeChainSteps(
  planSteps: PlanResponse['steps'],
  chainSteps: TaskStep[],
): { label: string; progress: StepProgress }[] {
  return planSteps.map((_step, i) => {
    const chain = chainSteps.find((s) => s.stepIdx === i)
    return {
      label: `Step ${i + 1}`,
      progress: chain ? deriveStepProgress(chain.state) : 'pending',
    }
  })
}

const MILESTONE_EVENT_TYPES = new Set(['task_created', 'task_completed', 'task_aborted'])

export function isMilestoneEvent(ev: StreamEvent): boolean {
  if (MILESTONE_EVENT_TYPES.has(ev.type)) return true
  if (ev.type === 'step_state') {
    const state = Number(ev.data.state)
    return (
      state === StepState.Succeeded ||
      state === StepState.Failed ||
      state === StepState.TimedOut
    )
  }
  return false
}

export function shouldSkipEventInChat(
  ev: StreamEvent,
  hasResult: boolean,
  taskCompleted: boolean,
): boolean {
  if (ev.type === 'task_completed' && (hasResult || taskCompleted)) return true
  if (ev.type === 'step_state' && !isMilestoneEvent(ev)) return true
  return false
}
