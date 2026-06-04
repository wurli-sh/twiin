import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Loader2, Send, Sparkles } from 'lucide-react'
import { parseEther } from 'viem'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { AgentSelector } from '@/components/console/AgentSelector'
import { PlanApproval } from '@/components/console/PlanApproval'
import { TaskTimeline } from '@/components/console/TaskTimeline'
import { TaskResult } from '@/components/console/TaskResult'
import { TwiinAvatar } from '@/components/ui/TwiinAvatar'
import { TextShimmer } from '@/components/ui/TextShimmer'
import { ThinkingSpinner } from '@/components/ui/ThinkingSpinner'
import { useTwiinAgents } from '@/hooks/useTwiinAgents'
import { useCreateTask } from '@/hooks/useCreateTask'
import { useAgentPolicy } from '@/hooks/useAgentPolicy'
import { useTaskStream } from '@/hooks/useTaskStream'
import { useTaskDetail } from '@/hooks/useTaskDetail'
import { useWallet } from '@/hooks/useWallet'
import { useUIStore } from '@/stores/ui'
import { PlanBudgetRecovery, type PlanBudgetMismatch } from '@/components/console/PlanBudgetRecovery'
import { requestPlan, isPlanOverBudgetError, type PlanResponse } from '@/lib/plan-api'
import { maxTaskBudgetStt } from '@/lib/agent-budget'
import { somniaTestnet } from '@/config/chains'
import { TaskState } from '@/config/contracts'
import { toast } from 'sonner'

const PROMPTS = [
  'Fetch Somnia ecosystem stats via oracle. Budget: 0.75 STT',
  'Research dreamDEX — should I LP?',
  'Daily Somnia sentiment oracle',
]

export function ConsolePage() {
  const { isConnected } = useWallet()
  const { agents, isLoading: agentsLoading, refetchAgents } = useTwiinAgents()
  const selectedAgentId = useUIStore((s) => s.selectedAgentId)
  const setSelectedAgentId = useUIStore((s) => s.setSelectedAgentId)

  const [goal, setGoal] = useState('')
  const [budgetStt, setBudgetStt] = useState('1')
  const [plan, setPlan] = useState<PlanResponse | null>(null)
  const [planGoal, setPlanGoal] = useState('')
  const [planMismatch, setPlanMismatch] = useState<PlanBudgetMismatch | null>(null)
  const [isPlanning, setIsPlanning] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [isRaisingCaps, setIsRaisingCaps] = useState(false)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [detailVersion, setDetailVersion] = useState(0)

  const { submitCreateTask } = useCreateTask()
  const { updatePolicy } = useAgentPolicy()
  const { events, connected } = useTaskStream(activeTaskId)
  const { task: chainTask, steps: chainSteps } = useTaskDetail(activeTaskId, detailVersion)

  const agentId = selectedAgentId ?? agents[0]?.id.toString() ?? null
  const agent = agents.find((a) => a.id.toString() === agentId)

  const budgetNum = Number(budgetStt)
  const maxPerTaskNum = agent ? Number(agent.maxPerTask) : 0
  const dailyRemaining =
    agent ? Math.max(0, Number(agent.dailyCap) - Number(agent.dailySpent)) : 0
  const lowBalance =
    agent && !Number.isNaN(budgetNum) && Number(agent.tbaBalance) < budgetNum
  const overPerTaskCap =
    agent && !Number.isNaN(budgetNum) && maxPerTaskNum > 0 && budgetNum > maxPerTaskNum
  const overDailyCap =
    agent && !Number.isNaN(budgetNum) && dailyRemaining > 0 && budgetNum > dailyRemaining

  useEffect(() => {
    const terminal = events.some(
      (e) => e.type === 'task_completed' || e.type === 'task_aborted',
    )
    if (terminal) setDetailVersion((v) => v + 1)
  }, [events])

  useEffect(() => {
    if (!selectedAgentId && agents[0]) {
      setSelectedAgentId(agents[0].id.toString())
    }
  }, [agents, selectedAgentId, setSelectedAgentId])

  useEffect(() => {
    if (!agent) return
    const affordable = maxTaskBudgetStt(agent)
    if (affordable > 0) {
      setBudgetStt(Math.min(affordable, Number(agent.maxPerTask)).toFixed(2))
    }
  }, [agent?.id.toString()])

  async function runPlan(trimmedGoal: string, budget: string) {
    if (!agentId || !agent) return
    setIsPlanning(true)
    setPlan(null)
    setPlanMismatch(null)
    try {
      const budgetWei = parseEther(budget).toString()
      const result = await requestPlan({
        goal: trimmedGoal,
        personalAgentId: agentId,
        budgetWei,
      })
      setPlan(result)
      setPlanGoal(trimmedGoal)
      toast.success('Plan ready — review and approve')
    } catch (e) {
      if (isPlanOverBudgetError(e)) {
        setPlanMismatch({ estimatedStt: e.estimatedStt, budgetStt: e.budgetStt })
      }
      toast.error(e instanceof Error ? e.message : 'Planning failed')
    } finally {
      setIsPlanning(false)
    }
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
    const maxPerTask = Number(agent.maxPerTask)
    if (maxPerTask > 0 && budgetNum > maxPerTask) {
      toast.error(`Budget exceeds per-task cap (${agent.maxPerTask} STT). Lower budget or update policy.`)
      return
    }
    const dailyLeft = Math.max(0, Number(agent.dailyCap) - Number(agent.dailySpent))
    if (dailyLeft > 0 && budgetNum > dailyLeft) {
      toast.error(`Budget exceeds daily cap remaining (${dailyLeft.toFixed(2)} STT).`)
      return
    }
    if (budgetNum > Number(agent.tbaBalance)) {
      toast.error(`6551 wallet only has ${agent.tbaBalance} STT. Fund the agent or lower budget.`)
      return
    }
    const trimmed = goal.trim()
    if (!trimmed) {
      toast.error('Describe a goal for your agent')
      return
    }

    await runPlan(trimmed, budgetStt)
  }

  async function handleSetBudgetAndRetry(nextBudget: string) {
    setBudgetStt(nextBudget)
    const trimmed = goal.trim() || planGoal.trim()
    if (!trimmed) {
      toast.error('Enter a goal first')
      return
    }
    await runPlan(trimmed, nextBudget)
  }

  async function handleRaiseCapsAndRetry(estimatedStt: number) {
    if (!agent) return
    const taskCap = Math.ceil(estimatedStt * 10) / 10 + 0.5
    const dailyCap = Math.max(taskCap * 2, 5)
    const nextBudget = taskCap.toFixed(1)

    if (Number(agent.tbaBalance) < taskCap) {
      toast.error(`Fund the 6551 wallet with at least ${taskCap.toFixed(1)} STT first (Agents page).`)
      return
    }

    setIsRaisingCaps(true)
    try {
      await updatePolicy({
        agentId: agent.id,
        dailyCapStt: dailyCap.toFixed(1),
        maxPerTaskStt: taskCap.toFixed(1),
        maxPerTaskTrustlessWei: parseEther(agent.maxPerTaskTrustless),
        killSwitch: agent.killSwitch,
      })
      toast.success(`Policy updated — ${taskCap.toFixed(1)} STT per task`)
      await refetchAgents()
      setBudgetStt(nextBudget)
      const trimmed = goal.trim() || planGoal.trim()
      if (trimmed) await runPlan(trimmed, nextBudget)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Policy update failed')
    } finally {
      setIsRaisingCaps(false)
    }
  }

  async function handleApprove() {
    if (!plan || !agent) return
    setIsApproving(true)
    try {
      const { txHash, taskId } = await submitCreateTask({
        agent,
        orchestrator: plan.orchestrator,
        budgetWei: BigInt(plan.budgetWei),
        createTaskCalldata: plan.createTaskCalldata,
      })
      setPlan(null)
      setPlanGoal('')
      setGoal('')
      if (taskId) {
        setActiveTaskId(taskId)
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

  function handleRejectPlan() {
    setPlan(null)
    setPlanGoal('')
  }

  if (!isConnected) {
    return (
      <div className="-mx-4 flex h-full flex-col items-center justify-center px-4 text-center sm:-mx-6">
        <TwiinAvatar name="janice" size="lg" className="mb-5" />
        <h1 className="text-2xl font-bold text-text">Twiin Console</h1>
        <p className="mt-2 max-w-sm text-sm text-text-muted">
          Connect your wallet to plan tasks, approve steps, and watch live execution.
        </p>
      </div>
    )
  }

  return (
    <div className="-mx-4 h-full overflow-hidden sm:-mx-6">
      <div className="mx-auto flex h-full max-w-3xl flex-col px-4 sm:px-6">
        <div className="mb-6 shrink-0 text-center">
          <TwiinAvatar name={agent?.name ?? 'janice'} size="lg" className="mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-text">
            {plan || isPlanning ? (
              'Review your plan'
            ) : activeTaskId ? (
              chainTask?.state === TaskState.Aborted ? (
                'Task aborted'
              ) : chainTask?.state === TaskState.Completed ? (
                'Task complete'
              ) : (
                'Task running'
              )
            ) : (
              <TextShimmer>What should your agent do?</TextShimmer>
            )}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Claude plans steps · you approve · keepers execute on Somnia
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-6">
          {!plan && !activeTaskId && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              <AgentSelector
                agents={agents}
                selectedId={agentId}
                onSelect={setSelectedAgentId}
                disabled={agentsLoading || isPlanning}
              />

              <div className="grid gap-2 sm:grid-cols-3">
                {PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={isPlanning}
                    onClick={() => {
                      const match = prompt.match(/Budget:\s*([\d.]+)\s*STT/i)
                      if (match) setBudgetStt(match[1])
                      setGoal(prompt.replace(/\.\s*Budget:.*/i, '').trim())
                    }}
                    className="cursor-pointer rounded-xl border border-border bg-surface px-3 py-2.5 text-left text-xs text-text-muted transition-colors hover:border-primary/30 hover:bg-surface-alt disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              <label className="block">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-text-faint">
                  Goal
                </span>
                <textarea
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  disabled={isPlanning}
                  rows={3}
                  placeholder="Describe what you want your Twiin to accomplish…"
                  className="w-full resize-none rounded-xl border border-border bg-surface-alt px-3 py-2.5 text-sm text-text outline-none placeholder:text-text-faint focus:border-primary/40 disabled:opacity-50"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-text-faint">
                  Task budget
                </span>
                <div className="flex items-center rounded-xl border border-border bg-surface-alt focus-within:border-primary/40">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={budgetStt}
                    onChange={(e) => setBudgetStt(e.target.value.replace(/[^0-9.]/g, ''))}
                    disabled={isPlanning}
                    className="w-full bg-transparent px-3 py-2.5 text-sm text-text outline-none disabled:opacity-50"
                  />
                  <span className="shrink-0 pr-3 text-xs font-semibold text-text-muted">STT</span>
                </div>
                {lowBalance && agent && (
                  <p className="mt-1.5 flex items-center gap-1 text-xs text-warning">
                    <AlertTriangle size={12} />
                    Agent wallet holds {agent.tbaBalance} STT — fund it or lower the budget
                    before approving.
                  </p>
                )}
                {overPerTaskCap && agent && (
                  <p className="mt-1.5 flex items-center gap-1 text-xs text-danger">
                    <AlertTriangle size={12} />
                    Per-task cap is {agent.maxPerTask} STT — default policy limits each task to 1 STT.
                  </p>
                )}
                {overDailyCap && agent && !overPerTaskCap && (
                  <p className="mt-1.5 flex items-center gap-1 text-xs text-danger">
                    <AlertTriangle size={12} />
                    Only {dailyRemaining.toFixed(2)} STT left in today&apos;s cap ({agent.dailyCap} STT).
                  </p>
                )}
                {agent?.killSwitch && (
                  <p className="mt-1.5 flex items-center gap-1 text-xs text-danger">
                    <AlertTriangle size={12} />
                    Kill switch is ON — enable the agent on Agents before planning.
                  </p>
                )}
                <p className="mt-1.5 text-xs text-text-faint">
                  Default policy: 1 STT per task, 2 STT daily. Native steps need ~0.12–0.33 STT each.
                </p>
              </label>

              {planMismatch && agent && (
                <PlanBudgetRecovery
                  agent={agent}
                  mismatch={planMismatch}
                  isRaisingCaps={isRaisingCaps}
                  onSetBudgetAndRetry={(b) => void handleSetBudgetAndRetry(b)}
                  onRaiseCapsAndRetry={(e) => void handleRaiseCapsAndRetry(e)}
                  onDismiss={() => setPlanMismatch(null)}
                />
              )}

              <Button
                type="button"
                className="w-full"
                disabled={
                  isPlanning ||
                  !agentId ||
                  agentsLoading ||
                  Boolean(agent?.killSwitch) ||
                  overPerTaskCap ||
                  overDailyCap ||
                  lowBalance
                }
                onClick={() => void handlePlan()}
              >
                {isPlanning ? (
                  <>
                    <ThinkingSpinner />
                    Planning with Claude…
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />
                    Generate plan
                  </>
                )}
              </Button>
            </motion.div>
          )}

          {isPlanning && !plan && (
            <div className="flex flex-col items-center py-12">
              <Loader2 size={24} className="animate-spin text-primary" />
              <p className="mt-3 text-sm text-text-muted">Haiku is drafting steps…</p>
            </div>
          )}

          {plan && agent && (
            <PlanApproval
              plan={plan}
              goal={planGoal}
              agent={agent}
              onApprove={handleApprove}
              onReject={handleRejectPlan}
              isSubmitting={isApproving}
            />
          )}

          {activeTaskId && (
            <>
              <TaskResult task={chainTask} steps={chainSteps} />
              <TaskTimeline
                taskId={activeTaskId}
                events={events}
                connected={connected}
                taskState={chainTask?.state ?? null}
              />
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => {
                  setActiveTaskId(null)
                  setGoal('')
                }}
              >
                <Send size={14} />
                New task
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
