import { NativeConfigId, StepState, TaskState } from '@/config/contracts'
import type { PlanStep } from '@/lib/plan-api'
import type { TaskStep } from '@/hooks/useTaskDetail'

export type AgentStatusPhase =
  | 'planning'
  | 'signing'
  | 'connecting'
  | 'dispatching'
  | 'waiting_janice'
  | 'executing'
  | 'waiting_result'
  | 'completing'

const TRUSTLESS_STATUS_PHRASES: Partial<Record<AgentStatusPhase, string[]>> = {
  planning: ['Checking trustless budget…', 'Building Janice context…'],
  signing: ['Awaiting your signature…', 'Locking trustless budget on-chain…'],
  dispatching: ['Submitting trustless task on-chain…', 'Opening live task stream…'],
  waiting_janice: [
    'Waiting for Janice on Somnia…',
    'Janice inference can take 1–15 minutes on testnet…',
    'Subcommittee is running inferToolsChat…',
  ],
  executing: ['Janice is coordinating agents…', 'Running hired sub-agents…'],
  completing: ['Janice is finishing up…', 'Finalizing trustless task…'],
}

const STATUS_PHRASES: Record<AgentStatusPhase, string[]> = {
  planning: [
    'Thinking through your goal…',
    'Sketching the playbook…',
    'Mapping agent steps…',
    'Consulting sub-agents…',
  ],
  signing: ['Awaiting your signature…', 'Locking plan on-chain…'],
  connecting: ['Connecting to live feed…', 'Opening task stream…'],
  dispatching: ['Keeper warming up…', 'Dispatching first step…', 'Spinning up execution…'],
  waiting_janice: ['Waiting for Janice on Somnia…'],
  executing: ['Running the plan…', 'Agents at work…'],
  waiting_result: ['Waiting on external result…', 'Awaiting sub-agent response…'],
  completing: ['Wrapping up…', 'Finalizing task…'],
}

const STEP_PHRASES: Record<number, string> = {
  [NativeConfigId.WEB_INTEL]: 'Scraping sources…',
  [NativeConfigId.ORACLE]: 'Fetching oracle data…',
  [NativeConfigId.ANALYSIS]: 'Analyzing sources…',
  [NativeConfigId.REPORTER]: 'Writing the report…',
  [NativeConfigId.EXECUTOR]: 'Executing on-chain…',
  [NativeConfigId.JANICE]: 'Coordinating agents…',
}

export function getStatusPhrases(
  phase: AgentStatusPhase,
  trustless = false,
): string[] {
  if (trustless && TRUSTLESS_STATUS_PHRASES[phase]) {
    return TRUSTLESS_STATUS_PHRASES[phase]!
  }
  return STATUS_PHRASES[phase]
}

export function resolveStepPhrase(stepIdx: number, planSteps: PlanStep[]): string | null {
  const step = planSteps[stepIdx]
  if (!step) return null
  return STEP_PHRASES[step.configId] ?? `Running step ${stepIdx + 1}…`
}

export function findActiveStepIndex(chainSteps: TaskStep[]): number | null {
  const active = chainSteps.find(
    (s) =>
      s.state === StepState.RunningNative ||
      s.state === StepState.RunningExternal ||
      s.state === StepState.Retrying,
  )
  return active?.stepIdx ?? null
}

export type ExecutionPhaseContext = {
  isApproving: boolean
  connected: boolean
  eventsCount: number
  chainSteps: TaskStep[]
  chainTaskState?: number
  trustless?: boolean
  hasJaniceActivity?: boolean
  hasTrustlessIntent?: boolean
  hasJaniceIteration?: boolean
}

export function resolveExecutionPhase(ctx: ExecutionPhaseContext): AgentStatusPhase {
  if (ctx.isApproving) return 'signing'
  if (!ctx.connected) return 'connecting'
  if (
    ctx.trustless &&
    ctx.hasTrustlessIntent &&
    !ctx.hasJaniceIteration &&
    ctx.chainTaskState === TaskState.Running
  ) {
    return 'waiting_janice'
  }
  if (ctx.eventsCount === 0) {
    return ctx.trustless ? 'waiting_janice' : 'dispatching'
  }
  if (ctx.trustless && ctx.hasJaniceActivity && ctx.chainSteps.length === 0) {
    return 'executing'
  }

  if (
    ctx.chainSteps.some(
      (s) =>
        s.state === StepState.RunningNative ||
        s.state === StepState.RunningExternal ||
        s.state === StepState.Retrying,
    )
  ) {
    return 'executing'
  }

  if (ctx.chainSteps.some((s) => s.state === StepState.AwaitingRating)) {
    return 'waiting_result'
  }

  const allSucceeded =
    ctx.chainSteps.length > 0 &&
    ctx.chainSteps.every((s) => s.state === StepState.Succeeded)

  if (allSucceeded && ctx.chainTaskState === TaskState.Running) {
    return 'completing'
  }

  return 'dispatching'
}

export function buildExecutionPhrases(
  phase: AgentStatusPhase,
  planSteps: PlanStep[] | undefined,
  chainSteps: TaskStep[],
): string[] {
  const base = getStatusPhrases(phase)
  if (phase !== 'executing' || !planSteps?.length) return base

  const activeIdx = findActiveStepIndex(chainSteps)
  if (activeIdx == null) return base

  const stepPhrase = resolveStepPhrase(activeIdx, planSteps)
  if (!stepPhrase) return base

  return [stepPhrase, ...base.filter((p) => p !== stepPhrase)]
}
