import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { formatEther, parseEther } from 'viem'
import { TranscriptPanel } from '@/components/console/TranscriptPanel'
import { ExecutionSidebar } from '@/components/console/ExecutionSidebar'
import { getExecutionStepSummary } from '@/components/console/ExecutionPanel'
import { CommandBar } from '@/components/console/CommandBar'
import { ConsoleTopBar } from '@/components/console/ConsoleTopBar'
import { SuggestedPrompts } from '@/components/console/SuggestedPrompts'
import { TwiinAvatar } from '@/components/ui/TwiinAvatar'
import { TextLoop } from '@/components/ui/TextLoop'
import { useTwiinAgents } from '@/hooks/useTwiinAgents'
import { useCreateTask } from '@/hooks/useCreateTask'
import { useCreateTrustlessTask } from '@/hooks/useCreateTrustlessTask'
import { useAgentPolicy } from '@/hooks/useAgentPolicy'
import { useTaskStream } from '@/hooks/useTaskStream'
import { useTaskDetail } from '@/hooks/useTaskDetail'
import { useWallet } from '@/hooks/useWallet'
import { useUIStore } from '@/stores/ui'
import { type PlanBudgetMismatch } from '@/components/console/PlanBudgetRecovery'
import {
  requestPlan,
  isPlanOverBudgetError,
  isPlanNoAgentError,
  isPlanUnavailableError,
} from '@/lib/plan-api'
import {
  clearPersistedSession,
  loadPersistedSession,
  persistSession,
} from '@/lib/console-session-storage'
import {
  requestTrustlessPreflight,
  isTrustlessBudgetTooLowError,
} from '@/lib/trustless-api'
import {
  getLowSignalSuggestions,
  getMaxPromptBudgetStt,
  suggestedConsoleBudgetStt,
  type ConsolePromptDef,
} from '@twiin/shared'
import type { ExecutionMode } from '@/config/features'
import { consolePageTheme } from '@/lib/execution-mode-theme'
import { cn } from '@/lib/cn'
import { type AgentStatusPhase } from '@/lib/agent-status-copy'
import {
  createEntryId,
  getPlanForExecution,
  getPendingPlanForTurn,
  removeStatusEntriesForTurn,
  getLastUserGoal,
  getCurrentTurnExecution,
  type SessionEntry,
} from '@/lib/console-session'
import {
  buildAbortResultText,
  resolveAbortDetail,
  resolveTaskReportText,
} from '@/lib/task-result-display'
import type { StreamEvent } from '@/hooks/useTaskStream'
import type { ChainTask, TaskStep } from '@/hooks/useTaskDetail'
import { TaskState } from '@/config/contracts'
import { somniaTestnet } from '@/config/chains'
import { toast } from 'sonner'

const PLAN_FETCH_TIMEOUT_MS = 120_000
const PLAN_FETCH_TIMEOUT_SECS = PLAN_FETCH_TIMEOUT_MS / 1000

function getLowSignalPromptNudge(rawInput: string): string | null {
  const trimmed = rawInput.trim()
  if (!trimmed) return null

  const normalized = trimmed.toLowerCase()
  const compact = normalized.replace(/[^a-z0-9? ]+/g, ' ').replace(/\s+/g, ' ').trim()
  const words = compact ? compact.split(' ') : []

  const hasIntentKeyword =
    /\b(fetch|research|analyze|analyse|check|compare|price|tvl|volume|token|oracle|sentiment|swap|lp|liquidity|agent|task|deploy|budget|stats)\b/i.test(
      normalized,
    )

  if (hasIntentKeyword) return null

  const casualOnly =
    /^(yo+|yo wassup|wassup|what'?s up|sup+|hey+|hi+|hello+|gm|gn|idk|hmm+|uh+|um+|test+|ping+|bro+|pls+|please+)\??$/i.test(
      compact,
    )
  const punctuationOnly = /^[^a-z0-9]+$/i.test(trimmed)
  const repeatedNoise = /(.)\1{4,}/.test(normalized)

  if (!casualOnly && !punctuationOnly && !repeatedNoise) return null
  if (words.length > 4 || trimmed.length > 24) return null

  return `That prompt is too vague to plan. Maybe try: ${getLowSignalSuggestions().join(' • ')}`
}

function appendResultForTask(
  entries: SessionEntry[],
  taskId: string,
  chainTask: ChainTask,
  chainSteps: TaskStep[],
  rawResult: string | undefined,
  abortReason: string | undefined,
  events: StreamEvent[],
): SessionEntry[] {
  if (entries.some((e) => e.kind === 'result' && e.taskId === taskId)) {
    return entries
  }

  const planEntry = getPlanForExecution(entries, taskId)
  const planSteps = planEntry?.kind === 'plan' ? planEntry.plan.steps : undefined
  const isAborted = chainTask.state === TaskState.Aborted

  if (isAborted) {
    const abortDetail = resolveAbortDetail(events, chainSteps, abortReason)
    return [
      ...entries,
      {
        id: createEntryId(),
        kind: 'result',
        taskId,
        text: buildAbortResultText(abortDetail),
        spent: Number(chainTask.spent).toFixed(4),
        budget: Number(chainTask.budget).toFixed(4),
        aborted: true,
        abortDetail,
      },
    ]
  }

  const displayText = resolveTaskReportText(rawResult, chainSteps, planSteps)
  if (!displayText) return entries

  return [
    ...entries,
    {
      id: createEntryId(),
      kind: 'result',
      taskId,
      text: displayText,
      spent: Number(chainTask.spent).toFixed(4),
      budget: Number(chainTask.budget).toFixed(4),
      aborted: isAborted,
    },
  ]
}

export function ConsolePage() {
  const { isConnected } = useWallet()
  const { agents, isLoading: agentsLoading, refetchAgents } = useTwiinAgents()
  const selectedAgentId = useUIStore((s) => s.selectedAgentId)
  const setSelectedAgentId = useUIStore((s) => s.setSelectedAgentId)

  const [sessionEntries, setSessionEntries] = useState<SessionEntry[]>([])
  const [sessionRestored, setSessionRestored] = useState(false)
  const [goal, setGoal] = useState('')
  const [budgetStt, setBudgetStt] = useState('4.5')
  const [planMismatch, setPlanMismatch] = useState<PlanBudgetMismatch | null>(null)
  const [isPlanning, setIsPlanning] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [isRaisingCaps, setIsRaisingCaps] = useState(false)
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('claude')
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [detailVersion, setDetailVersion] = useState(0)
  const [executionPanelOpen, setExecutionPanelOpen] = useState(true)
  const [mobileExecutionPanelOpen, setMobileExecutionPanelOpen] = useState(false)

  const { submitCreateTask } = useCreateTask()
  const { submitCreateTrustlessTask } = useCreateTrustlessTask()
  const { updatePolicy } = useAgentPolicy()
  const { events, connected } = useTaskStream(activeTaskId)
  const { task: chainTask, steps: chainSteps, completion: taskCompletion } =
    useTaskDetail(activeTaskId, detailVersion)

  const streamedCompletedResult =
    [...events]
      .reverse()
      .find((event) => event.type === 'task_completed' && typeof event.data.result === 'string')
      ?.data.result as string | undefined
  const streamedAbortReason =
    [...events]
      .reverse()
      .find((event) => event.type === 'task_aborted' && typeof event.data.reason === 'string')
      ?.data.reason as string | undefined

  const agentId = selectedAgentId ?? agents[0]?.id.toString() ?? null
  const agent = agents.find((a) => a.id.toString() === agentId)
  const hasPendingPlan = getPendingPlanForTurn(sessionEntries) != null
  const taskRunning = chainTask?.state === TaskState.Running
  const taskTerminal =
    chainTask?.state === TaskState.Completed || chainTask?.state === TaskState.Aborted

  const budgetNum = Number(budgetStt)
  const maxPerTaskNum =
    agent
      ? Number(executionMode === 'trustless' ? agent.maxPerTaskTrustless : agent.maxPerTask)
      : 0
  const dailyRemaining =
    agent ? Math.max(0, Number(agent.dailyCap) - Number(agent.dailySpent)) : 0
  const lowBalance =
    agent && !Number.isNaN(budgetNum) && Number(agent.tbaBalance) < budgetNum
  const overPerTaskCap =
    agent && !Number.isNaN(budgetNum) && maxPerTaskNum > 0 && budgetNum > maxPerTaskNum
  const overDailyCap =
    agent && !Number.isNaN(budgetNum) && dailyRemaining > 0 && budgetNum > dailyRemaining

  const composerLocked =
    isPlanning ||
    isApproving ||
    isRaisingCaps ||
    hasPendingPlan ||
    Boolean(activeTaskId && taskRunning) ||
    !agentId ||
    agentsLoading ||
    Boolean(agent?.killSwitch)

  const hasBudgetIssue = Boolean(overPerTaskCap || overDailyCap || lowBalance)
  const submitDisabled = composerLocked || hasBudgetIssue

  const hasActivity = sessionEntries.length > 0
  const currentTurnExecution = getCurrentTurnExecution(sessionEntries)
  const stepSummary = getExecutionStepSummary(
    sessionEntries,
    chainSteps,
    currentTurnExecution?.taskId,
    activeTaskId,
  )
  const stepProgressLabel =
    stepSummary && taskRunning ? `${stepSummary.done}/${stepSummary.total}` : null
  const modeTheme = consolePageTheme()
  const modeToggleDisabled = isPlanning || isApproving || hasActivity

  const appendEntry = useCallback((entry: SessionEntry) => {
    setSessionEntries((prev) => [...prev, entry])
  }, [])

  const appendStatusForTurn = useCallback((phase: AgentStatusPhase) => {
    setSessionEntries((prev) => [
      ...removeStatusEntriesForTurn(prev),
      { id: createEntryId(), kind: 'status', phase },
    ])
  }, [])

  const removeStatusForTurn = useCallback(() => {
    setSessionEntries((prev) => removeStatusEntriesForTurn(prev))
  }, [])

  const updatePlanStatus = useCallback(
    (planEntryId: string, status: 'pending' | 'approved' | 'rejected' | 'expired') => {
      setSessionEntries((prev) =>
        prev.map((e) =>
          e.id === planEntryId && e.kind === 'plan' ? { ...e, status } : e,
        ),
      )
      if (status !== 'pending') clearPersistedSession()
    },
    [],
  )

  useEffect(() => {
    const terminal = events.some(
      (e) => e.type === 'task_completed' || e.type === 'task_aborted',
    )
    if (terminal) setDetailVersion((v) => v + 1)
  }, [events])

  useEffect(() => {
    if (sessionRestored || !agentId) return
    const persisted = loadPersistedSession(agentId)
    if (persisted.length > 0) setSessionEntries(persisted)
    setSessionRestored(true)
  }, [agentId, sessionRestored])

  useEffect(() => {
    persistSession(agentId, sessionEntries)
  }, [agentId, sessionEntries])

  useEffect(() => {
    if (!selectedAgentId && agents[0]) {
      setSelectedAgentId(agents[0].id.toString())
    }
  }, [agents, selectedAgentId, setSelectedAgentId])

  useEffect(() => {
    if (!agent || sessionEntries.length > 0) return
    setBudgetStt(suggestedConsoleBudgetStt(agent))
  }, [agent?.id.toString(), sessionEntries.length, executionMode])

  useEffect(() => {
    const terminalEvent = events.some(
      (e) => e.type === 'task_completed' || e.type === 'task_aborted',
    )
    if (!chainTask || (!taskTerminal && !terminalEvent)) return

    const taskId = activeTaskId
    if (!taskId) return

    const rawResult = taskCompletion?.decoded ?? streamedCompletedResult
    setSessionEntries((prev) =>
      appendResultForTask(
        prev,
        taskId,
        chainTask,
        chainSteps,
        rawResult,
        streamedAbortReason,
        events,
      ),
    )
  }, [
    activeTaskId,
    chainTask,
    chainSteps,
    taskTerminal,
    taskCompletion,
    streamedCompletedResult,
    streamedAbortReason,
    events,
  ])

  useEffect(() => {
    if (!activeTaskId || !chainTask || chainTask.state !== TaskState.Completed) return
    if (sessionEntries.some((e) => e.kind === 'result' && e.taskId === activeTaskId)) return

    const planEntry = getPlanForExecution(sessionEntries, activeTaskId)
    const planSteps = planEntry?.kind === 'plan' ? planEntry.plan.steps : undefined
    const rawResult = taskCompletion?.decoded ?? streamedCompletedResult
    if (resolveTaskReportText(rawResult, chainSteps, planSteps)) return

    const timeout = window.setTimeout(() => {
      setSessionEntries((prev) => {
        if (prev.some((e) => e.kind === 'result' && e.taskId === activeTaskId)) return prev
        const plan = getPlanForExecution(prev, activeTaskId)
        const steps = plan?.kind === 'plan' ? plan.plan.steps : undefined
        const text =
          resolveTaskReportText(rawResult, chainSteps, steps) ??
          '### Task complete\n\n_Report is still syncing from chain. Check the execution panel for step outputs._'
        return [
          ...prev,
          {
            id: createEntryId(),
            kind: 'result',
            taskId: activeTaskId,
            text,
            spent: Number(chainTask.spent).toFixed(4),
            budget: Number(chainTask.budget).toFixed(4),
            aborted: false,
          },
        ]
      })
    }, 48_000)

    return () => window.clearTimeout(timeout)
  }, [
    activeTaskId,
    chainTask,
    chainSteps,
    taskCompletion,
    streamedCompletedResult,
    sessionEntries,
  ])

  async function runPlan(trimmedGoal: string, budget: string) {
    if (!agentId || !agent) return
    setIsPlanning(true)
    setPlanMismatch(null)
    appendStatusForTurn('planning')

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), PLAN_FETCH_TIMEOUT_MS)

    try {
      const budgetWei = parseEther(budget).toString()
      const result = await requestPlan({
        goal: trimmedGoal,
        personalAgentId: agentId,
        budgetWei,
        signal: controller.signal,
      })
      removeStatusForTurn()
      appendEntry({
        id: createEntryId(),
        kind: 'plan',
        goal: trimmedGoal,
        plan: result,
        status: 'pending',
      })
      setGoal('')
      toast.success('Plan ready — review and approve')
    } catch (e) {
      removeStatusForTurn()
      if (e instanceof Error && e.name === 'AbortError') {
        appendEntry({
          id: createEntryId(),
          kind: 'error',
          text: `Planning timed out after ${PLAN_FETCH_TIMEOUT_SECS}s. Try again.`,
        })
        toast.error(`Planning timed out after ${PLAN_FETCH_TIMEOUT_SECS}s — try again`)
      } else if (isPlanOverBudgetError(e)) {
        setPlanMismatch({ estimatedStt: e.estimatedStt, budgetStt: e.budgetStt })
      } else if (isPlanNoAgentError(e)) {
        const agentHint = e.agentName
          ? `${e.agentName}${e.unhealthyConfigId != null ? ` (configId ${e.unhealthyConfigId})` : ''}`
          : null
        appendEntry({
          id: createEntryId(),
          kind: 'error',
          text: agentHint
            ? `${e.message} Start it with pnpm dev:agents (or deploy to a public URL the backend can reach).`
            : e.missingCapabilities?.length
              ? `No capable agent available (${e.missingCapabilities.join(', ')}). Register an external agent or raise budget.`
              : e.message,
        })
        toast.error(
          agentHint
            ? `External agent offline: ${agentHint}`
            : 'No capable agent available for this goal',
        )
      } else if (isPlanUnavailableError(e)) {
        appendEntry({
          id: createEntryId(),
          kind: 'error',
          text: `${e.message}${e.retryAfterSeconds ? ` Retry in ${e.retryAfterSeconds}s.` : ' Try again shortly.'}`,
        })
        toast.error('Planner temporarily unavailable — try again')
      } else {
        appendEntry({
          id: createEntryId(),
          kind: 'error',
          text: e instanceof Error ? e.message : 'Planning failed',
        })
        toast.error(e instanceof Error ? e.message : 'Planning failed')
      }
    } finally {
      clearTimeout(timeoutId)
      setIsPlanning(false)
    }
  }

  async function runTrustless(trimmedGoal: string, budget: string) {
    if (!agentId || !agent) return
    setIsPlanning(true)
    appendStatusForTurn('planning')
    try {
      const budgetWei = parseEther(budget).toString()
      const preflight = await requestTrustlessPreflight({
        goal: trimmedGoal,
        personalAgentId: agentId,
        budgetWei,
      })
      removeStatusForTurn()
      appendEntry({
        id: createEntryId(),
        kind: 'trustless_preflight',
        goal: trimmedGoal,
        minBudgetStt: Number(formatEther(BigInt(preflight.minBudgetWei))).toFixed(4),
        janiceCostStt: Number(formatEther(BigInt(preflight.janiceCostWei))).toFixed(4),
        maxIterations: preflight.maxIterations,
        warnings: preflight.warnings,
      })

      setIsApproving(true)
      const { txHash, taskId } = await submitCreateTrustlessTask({
        agent,
        orchestrator: preflight.orchestrator,
        budgetWei: BigInt(preflight.budgetWei),
        createTaskCalldata: preflight.createTaskCalldata,
      })

      setGoal('')
      if (taskId) {
        setActiveTaskId(taskId)
        appendEntry({ id: createEntryId(), kind: 'execution', taskId })
        toast.success(`Trustless task #${taskId} created`)
      } else {
        toast.success('Trustless task submitted')
      }

      const explorer = somniaTestnet.blockExplorers.default.url
      toast.message(
        <a href={`${explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer">
          View transaction
        </a>,
      )
    } catch (e) {
      removeStatusForTurn()
      if (isTrustlessBudgetTooLowError(e)) {
        appendEntry({
          id: createEntryId(),
          kind: 'error',
          text: `Trustless mode needs at least ${Number(formatEther(BigInt(e.minBudgetWei))).toFixed(4)} STT to start.`,
        })
        toast.error('Budget below trustless minimum')
      } else {
        appendEntry({
          id: createEntryId(),
          kind: 'error',
          text: e instanceof Error ? e.message : 'Trustless preflight failed',
        })
        toast.error(e instanceof Error ? e.message : 'Trustless preflight failed')
      }
    } finally {
      setIsPlanning(false)
      setIsApproving(false)
    }
  }

  function resolveGoalInput(
    rawInput: string,
  ): { goal: string; aliasUsed?: string; error?: string } | null {
    const trimmed = rawInput.trim()
    if (!trimmed) return null

    const normalized = trimmed.toLowerCase()
    const redoOnlyPattern =
      /^(redo|retry|rerun|re-run|run that again|do that again|same again|again)\W*$/i

    if (redoOnlyPattern.test(normalized)) {
      const previousGoal = getLastUserGoal(sessionEntries)
      if (!previousGoal) {
        return {
          goal: '',
          aliasUsed: trimmed,
          error: 'Nothing to redo yet. Run a task first or describe a new goal.',
        }
      }
      return { goal: previousGoal, aliasUsed: trimmed }
    }

    return { goal: trimmed }
  }

  async function handlePlan() {
    if (!agentId || !agent) {
      toast.error('Select an agent first')
      return
    }
    if (agent.killSwitch) {
      toast.error('Enable your agent on the Agents page before planning')
      return
    }
    const budgetNum = Number(budgetStt)
    if (!budgetStt || Number.isNaN(budgetNum) || budgetNum <= 0) {
      toast.error('Enter a valid budget in STT')
      return
    }
    const policyReady = await ensurePolicyCapsForBudget(budgetNum)
    if (!policyReady) return
    if (budgetNum > Number(agent.tbaBalance)) {
      toast.error(`6551 wallet only has ${agent.tbaBalance} STT. Fund the agent or lower budget.`)
      return
    }
    const resolved = resolveGoalInput(goal)
    if (!resolved) {
      toast.error('Describe a goal for your agent')
      return
    }
    if (resolved.error) {
      toast.error(resolved.error)
      return
    }

    const lowSignalNudge = getLowSignalPromptNudge(resolved.goal)
    if (lowSignalNudge) {
      appendEntry({
        id: createEntryId(),
        kind: 'error',
        text: lowSignalNudge,
      })
      toast.error('Prompt too vague to plan')
      return
    }

    setPlanMismatch(null)

    if (activeTaskId && chainTask && (taskTerminal || !taskRunning)) {
      const rawResult = taskCompletion?.decoded ?? streamedCompletedResult
      setSessionEntries((prev) =>
        appendResultForTask(
          prev,
          activeTaskId,
          chainTask,
          chainSteps,
          rawResult,
          streamedAbortReason,
          events,
        ),
      )
      setActiveTaskId(null)
    }

    appendEntry({
      id: createEntryId(),
      kind: 'user',
      text: resolved.goal,
      budgetStt,
    })
    if (resolved.aliasUsed) toast.success('Re-running the previous task')

    if (executionMode === 'trustless') {
      await runTrustless(resolved.goal, budgetStt)
    } else {
      await runPlan(resolved.goal, budgetStt)
    }
  }

  async function handleSetBudgetAndRetry(nextBudget: string) {
    setBudgetStt(nextBudget)
    const lastUser = [...sessionEntries].reverse().find((e) => e.kind === 'user')
    const trimmed = lastUser?.kind === 'user' ? lastUser.text : goal.trim()
    if (!trimmed) {
      toast.error('Enter a goal first')
      return
    }
    if (executionMode === 'trustless') {
      await runTrustless(trimmed, nextBudget)
    } else {
      await runPlan(trimmed, nextBudget)
    }
  }

  async function ensurePolicyCapsForBudget(budgetNum: number): Promise<boolean> {
    if (!agent) return false

    const maxPerTask = Number(
      executionMode === 'trustless' ? agent.maxPerTaskTrustless : agent.maxPerTask,
    )
    const dailyLeft = Math.max(0, Number(agent.dailyCap) - Number(agent.dailySpent))
    const needsRaise =
      (maxPerTask > 0 && budgetNum > maxPerTask) ||
      (dailyLeft > 0 && budgetNum > dailyLeft) ||
      (dailyLeft <= 0 && budgetNum > 0)

    if (!needsRaise) return true

    const taskCap = Math.ceil(budgetNum * 10) / 10 + 0.5
    const dailyCap = Math.max(taskCap * 2, 5)

    if (Number(agent.tbaBalance) < taskCap) {
      toast.error(`Fund the 6551 wallet with at least ${taskCap.toFixed(1)} STT first (Agents page).`)
      return false
    }

    setIsRaisingCaps(true)
    try {
      const trustlessCap =
        executionMode === 'trustless' ? taskCap : Number(agent.maxPerTaskTrustless)
      await updatePolicy({
        agentId: agent.id,
        dailyCapStt: dailyCap.toFixed(1),
        maxPerTaskStt: executionMode === 'trustless' ? agent.maxPerTask : taskCap.toFixed(1),
        maxPerTaskTrustlessWei: parseEther(trustlessCap.toFixed(1)),
        killSwitch: agent.killSwitch,
      })
      toast.success(
        executionMode === 'trustless'
          ? `Policy raised — ${taskCap.toFixed(1)} STT per trustless task`
          : `Policy raised — ${taskCap.toFixed(1)} STT per task`,
      )
      await refetchAgents()
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Policy update failed')
      return false
    } finally {
      setIsRaisingCaps(false)
    }
  }

  async function handleRaiseCapsAndRetry(estimatedStt: number) {
    const taskCap = Math.ceil(estimatedStt * 10) / 10 + 0.5
    const nextBudget = taskCap.toFixed(1)
    const policyReady = await ensurePolicyCapsForBudget(estimatedStt)
    if (!policyReady) return

    setBudgetStt(nextBudget)
    const lastUser = [...sessionEntries].reverse().find((e) => e.kind === 'user')
    const trimmed = lastUser?.kind === 'user' ? lastUser.text : goal.trim()
    if (trimmed) {
      if (executionMode === 'trustless') await runTrustless(trimmed, nextBudget)
      else await runPlan(trimmed, nextBudget)
    }
  }

  async function handleApprove(planEntryId: string) {
    const planEntry = sessionEntries.find(
      (e) => e.id === planEntryId && e.kind === 'plan',
    )
    if (!planEntry || planEntry.kind !== 'plan' || !agent) return

    setIsApproving(true)
    try {
      const { txHash, taskId } = await submitCreateTask({
        agent,
        orchestrator: planEntry.plan.orchestrator,
        budgetWei: BigInt(planEntry.plan.budgetWei),
        createTaskCalldata: planEntry.plan.createTaskCalldata,
      })

      updatePlanStatus(planEntryId, 'approved')

      if (taskId) {
        setActiveTaskId(taskId)
        appendEntry({ id: createEntryId(), kind: 'execution', taskId })
        toast.success(`Task #${taskId} created`)
      } else {
        toast.success('Task submitted — watch backend for task id')
      }

      const explorer = somniaTestnet.blockExplorers.default.url
      toast.message(
        <a href={`${explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer">
          View transaction
        </a>,
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'createTask failed')
    } finally {
      setIsApproving(false)
    }
  }

  function handleRejectPlan(planEntryId: string, reason: 'user' | 'expired') {
    updatePlanStatus(planEntryId, reason === 'expired' ? 'expired' : 'rejected')
  }

  function handleNewTask() {
    setSessionEntries([])
    setActiveTaskId(null)
    setGoal('')
    setPlanMismatch(null)
    setDetailVersion(0)
    setExecutionPanelOpen(true)
    setMobileExecutionPanelOpen(false)
  }

  function handleStepsToggle() {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setExecutionPanelOpen((open) => !open)
      return
    }
    setMobileExecutionPanelOpen((open) => !open)
  }

  async function handlePromptSelect(prompt: ConsolePromptDef) {
    setGoal(prompt.goal)
    const budgetNum = Number(prompt.budgetStt)
    if (agent) {
      const policyReady = await ensurePolicyCapsForBudget(budgetNum)
      if (!policyReady) return
    }
    setBudgetStt(prompt.budgetStt)
  }

  async function handleRaiseCapsFromWarning() {
    if (!agent || Number.isNaN(budgetNum) || budgetNum <= 0) return
    await ensurePolicyCapsForBudget(budgetNum)
  }

  if (!isConnected) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 text-center">
        <TwiinAvatar name="janice" size="lg" className="mb-5" />
        <h1 className="text-2xl font-bold text-foreground">Twiin Console</h1>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Connect your wallet to plan tasks, approve steps, and watch live execution.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-full w-full flex-col">
        <ConsoleTopBar
          hasActivity={hasActivity}
          executionMode={executionMode}
          onExecutionModeChange={setExecutionMode}
          agents={agents}
          agentId={agentId}
          agent={agent}
          agentsLoading={agentsLoading}
          onSelectAgent={setSelectedAgentId}
          onNewSession={hasActivity ? handleNewTask : undefined}
          lowBalance={Boolean(lowBalance)}
          overPerTaskCap={Boolean(overPerTaskCap)}
          overDailyCap={Boolean(overDailyCap)}
          dailyRemaining={dailyRemaining}
          maxPerTaskNum={maxPerTaskNum}
          onRaiseCaps={
            agent && (overPerTaskCap || overDailyCap) ? handleRaiseCapsFromWarning : undefined
          }
          isRaisingCaps={isRaisingCaps}
          modeToggleDisabled={modeToggleDisabled}
          agentSelectorDisabled={isPlanning || isApproving}
          showStepsToggle={hasActivity}
          stepsToggleActive={executionPanelOpen || mobileExecutionPanelOpen}
          stepProgressLabel={stepProgressLabel}
          onStepsToggle={handleStepsToggle}
        />

        {!hasActivity ? (
          <div className="flex flex-1 flex-col items-center justify-center px-4">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
              className="mb-6 w-full text-center"
            >
              <h2 className="text-xl font-bold tracking-normal text-foreground sm:text-2xl">
                Hey! What are we{' '}
                <TextLoop
                  interval={2.5}
                  className={cn(
                    'rounded-md px-2 py-0.5 font-mono tabular-nums',
                    modeTheme.badge,
                  )}
                >
                  <span>oracling-now</span>
                  <span>speedrunning</span>
                  <span>info-hunting</span>
                  <span>chain-poking</span>
                  <span>rpc-bullying</span>
                  <span>task-routing</span>
                  <span>sub-agenting</span>
                  <span>re-deploying</span>
                  <span>feed-reading</span>
                  <span>feed-pushing</span>
                  <span>gas-tracking</span>
                  <span>goal-mapping</span>
                  <span>tx-broadcast</span>
                  <span>autonomizing</span>
                  <span>alpha-mining</span>
                  <span>budget-guard</span>
                  <span>goal-chasing</span>
                  <span>lane-routing</span>
                  <span>cap-checking</span>
                  <span>oracle-nudge</span>
                  <span>market-sniff</span>
                  <span>signal-sniff</span>
                  <span>rpc-prodding</span>
                </TextLoop>
                {' '}today?
              </h2>
              <p className={cn('mt-1.5 text-sm', modeTheme.subtitle)}>
                Plan your steps, approve on-chain, and let keepers execute on Somnia.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.15, ease: [0.23, 1, 0.32, 1] }}
              className="w-full"
            >
              <CommandBar
                goal={goal}
                budgetStt={budgetStt}
                onGoalChange={setGoal}
                onBudgetChange={setBudgetStt}
                onSubmit={() => void handlePlan()}
                disabled={composerLocked}
                submitDisabled={submitDisabled}
                isPlanning={isPlanning}
              />
              <SuggestedPrompts
                disabled={composerLocked || isPlanning}
                onSelect={handlePromptSelect}
              />
              {agent && Number(agent.maxPerTask) < getMaxPromptBudgetStt() && (
                <p className="mt-2 text-center text-[10px] text-warning">
                  Suggested prompts need up to {getMaxPromptBudgetStt()} STT per task — raise max per
                  task on the Agents page.
                </p>
              )}
            </motion.div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <TranscriptPanel
                sessionEntries={sessionEntries}
                agent={agent}
                isApproving={isApproving}
                planMismatch={planMismatch}
                isRaisingCaps={isRaisingCaps}
                activeTaskId={activeTaskId}
                events={events}
                connected={connected}
                chainTask={chainTask}
                chainSteps={chainSteps}
                onApprove={handleApprove}
                onReject={handleRejectPlan}
                onSetBudgetAndRetry={(b) => void handleSetBudgetAndRetry(b)}
                onRaiseCapsAndRetry={(e) => void handleRaiseCapsAndRetry(e)}
                onDismissMismatch={() => setPlanMismatch(null)}
                executionMode={executionMode}
              />

              <div className="pointer-events-none relative z-10 -mt-12 h-12 bg-gradient-to-t from-background to-transparent" />

              <div className="shrink-0 px-4 pt-1 pb-2">
                <CommandBar
                  goal={goal}
                  budgetStt={budgetStt}
                  onGoalChange={setGoal}
                  onBudgetChange={setBudgetStt}
                  onSubmit={() => void handlePlan()}
                  disabled={composerLocked}
                  submitDisabled={submitDisabled}
                  isPlanning={isPlanning}
                  showHint={false}
                />
              </div>
            </div>

            <ExecutionSidebar
              open={executionPanelOpen}
              mobileOpen={mobileExecutionPanelOpen}
              onMobileClose={() => setMobileExecutionPanelOpen(false)}
              entries={sessionEntries}
              chainSteps={chainSteps}
              chainTaskState={chainTask?.state}
              activeExecutionTaskId={currentTurnExecution?.taskId}
              hookTaskId={activeTaskId}
              executionMode={executionMode}
            />
          </div>
        )}
      </div>
    </div>
  )
}
