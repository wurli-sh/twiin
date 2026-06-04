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
import { useTaskStream } from '@/hooks/useTaskStream'
import { useTaskDetail } from '@/hooks/useTaskDetail'
import { useWallet } from '@/hooks/useWallet'
import { useUIStore } from '@/stores/ui'
import { requestPlan, type PlanResponse } from '@/lib/plan-api'
import { somniaTestnet } from '@/config/chains'
import { toast } from 'sonner'

const PROMPTS = [
  'Check Somnia ecosystem health. Budget: 0.9 STT',
  'Research dreamDEX — should I LP?',
  'Daily Somnia sentiment oracle',
]

export function ConsolePage() {
  const { isConnected } = useWallet()
  const { agents, isLoading: agentsLoading } = useTwiinAgents()
  const selectedAgentId = useUIStore((s) => s.selectedAgentId)
  const setSelectedAgentId = useUIStore((s) => s.setSelectedAgentId)

  const [goal, setGoal] = useState('')
  const [budgetStt, setBudgetStt] = useState('0.9')
  const [plan, setPlan] = useState<PlanResponse | null>(null)
  const [planGoal, setPlanGoal] = useState('')
  const [isPlanning, setIsPlanning] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [detailVersion, setDetailVersion] = useState(0)

  const { submitCreateTask } = useCreateTask()
  const { events, connected } = useTaskStream(activeTaskId)
  const { task: chainTask, steps: chainSteps } = useTaskDetail(activeTaskId, detailVersion)

  const agentId = selectedAgentId ?? agents[0]?.id.toString() ?? null
  const agent = agents.find((a) => a.id.toString() === agentId)

  const budgetNum = Number(budgetStt)
  const lowBalance =
    agent && !Number.isNaN(budgetNum) && Number(agent.tbaBalance) < budgetNum

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

  async function handlePlan() {
    if (!agentId || !agent) {
      toast.error('Select an agent first')
      return
    }
    if (agent.killSwitch) {
      toast.error('Enable the agent kill switch before planning')
      return
    }
    const trimmed = goal.trim()
    if (!trimmed) {
      toast.error('Describe a goal for your agent')
      return
    }
    const budgetNum = Number(budgetStt)
    if (!budgetStt || Number.isNaN(budgetNum) || budgetNum <= 0) {
      toast.error('Enter a valid budget in STT')
      return
    }

    setIsPlanning(true)
    setPlan(null)
    try {
      const budgetWei = parseEther(budgetStt).toString()
      const result = await requestPlan({
        goal: trimmed,
        personalAgentId: agentId,
        budgetWei,
      })
      setPlan(result)
      setPlanGoal(trimmed)
      toast.success('Plan ready — review and approve')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Planning failed')
    } finally {
      setIsPlanning(false)
    }
  }

  async function handleApprove() {
    if (!plan || !agent) return
    setIsApproving(true)
    try {
      const { txHash, taskId } = await submitCreateTask({
        tbaAddress: agent.tbaAddress,
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
              'Task running'
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
              </label>

              <Button
                type="button"
                className="w-full"
                disabled={isPlanning || !agentId || agentsLoading}
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

          {plan && (
            <PlanApproval
              plan={plan}
              goal={planGoal}
              onApprove={handleApprove}
              onReject={handleRejectPlan}
              isSubmitting={isApproving}
            />
          )}

          {activeTaskId && (
            <>
              <TaskResult task={chainTask} steps={chainSteps} />
              <TaskTimeline taskId={activeTaskId} events={events} connected={connected} />
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
