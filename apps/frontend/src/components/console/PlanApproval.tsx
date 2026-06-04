import { useEffect, useState, useRef, useMemo } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Check, Clock, Loader2, X } from 'lucide-react'
import { formatEther } from 'viem'
import { Button } from '@/components/ui/Button'
import { configIdLabel } from '@/lib/config-names'
import type { PlanResponse } from '@/lib/plan-api'
import type { TwiinAgentInfo } from '@/hooks/useTwiinAgents'
import { cn } from '@/lib/cn'

const APPROVAL_SECONDS = 60

type PlanApprovalProps = {
  plan: PlanResponse
  goal: string
  agent: TwiinAgentInfo
  onApprove: () => Promise<void>
  onReject: () => void
  isSubmitting: boolean
}

export function PlanApproval({
  plan,
  goal,
  agent,
  onApprove,
  onReject,
  isSubmitting,
}: PlanApprovalProps) {
  const [secondsLeft, setSecondsLeft] = useState(APPROVAL_SECONDS)

  const expiredRef = useRef(false)

  useEffect(() => {
    expiredRef.current = false
    setSecondsLeft(APPROVAL_SECONDS)
    const t = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          window.clearInterval(t)
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => window.clearInterval(t)
  }, [plan])

  useEffect(() => {
    if (secondsLeft !== 0 || expiredRef.current) return
    expiredRef.current = true
    onReject()
  }, [secondsLeft, onReject])

  const pct = (secondsLeft / APPROVAL_SECONDS) * 100
  const expired = secondsLeft === 0

  const budgetStt = Number(formatEther(BigInt(plan.budgetWei)))
  const blockReason = useMemo(() => {
    if (agent.killSwitch) return 'Kill switch is ON — enable the agent on Agents first.'
    if (budgetStt > Number(agent.maxPerTask)) {
      return `Budget ${budgetStt.toFixed(2)} STT exceeds per-task cap ${agent.maxPerTask} STT.`
    }
    const dailyLeft = Math.max(0, Number(agent.dailyCap) - Number(agent.dailySpent))
    if (dailyLeft > 0 && budgetStt > dailyLeft) {
      return `Budget exceeds daily cap remaining (${dailyLeft.toFixed(2)} STT).`
    }
    if (budgetStt > Number(agent.tbaBalance)) {
      return `6551 wallet only has ${agent.tbaBalance} STT.`
    }
    return null
  }, [agent, budgetStt, plan.budgetWei])

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-primary/30 bg-surface p-5"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
            Plan ready — approve within 60s
          </p>
          <p className="mt-1 text-sm text-text-muted line-clamp-2">{goal}</p>
        </div>
        <div
          className={cn(
            'flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold tabular-nums',
            secondsLeft <= 10 ? 'bg-danger/15 text-danger' : 'bg-primary/15 text-primary',
          )}
        >
          <Clock size={12} />
          {secondsLeft}s
        </div>
      </div>

      <div className="mb-4 h-1 overflow-hidden rounded-full bg-surface-alt">
        <div
          className={cn(
            'h-full transition-all duration-1000 ease-linear',
            secondsLeft <= 10 ? 'bg-danger' : 'bg-primary',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      <ol className="mb-4 space-y-2">
        {plan.steps.map((step, i) => (
          <li
            key={`${step.configId}-${i}`}
            className="rounded-lg border border-border bg-surface-alt/80 px-3 py-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-text">
                {i + 1}. {configIdLabel(step.configId)}
              </span>
              <span className="shrink-0 text-[10px] font-semibold text-text-faint">
                max {Number(formatEther(BigInt(step.maxCostWei))).toFixed(3)} STT
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-[11px] text-text-muted">{step.payload}</p>
          </li>
        ))}
      </ol>

      <div className="mb-4 flex justify-between text-xs text-text-muted">
        <span>
          Estimated{' '}
          <strong className="text-text">
            {Number(formatEther(BigInt(plan.estimatedCostWei))).toFixed(4)} STT
          </strong>
        </span>
        <span>
          Budget{' '}
          <strong className="text-text">
            {Number(formatEther(BigInt(plan.budgetWei))).toFixed(4)} STT
          </strong>
        </span>
      </div>

      {blockReason && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {blockReason}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          className="flex-1"
          disabled={expired || isSubmitting || Boolean(blockReason)}
          onClick={() => void onApprove()}
        >
          {isSubmitting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Signing createTask…
            </>
          ) : (
            <>
              <Check size={16} />
              Approve & create task
            </>
          )}
        </Button>
        <Button type="button" variant="outline" disabled={isSubmitting} onClick={onReject}>
          <X size={16} />
          Reject
        </Button>
      </div>

      {expired && (
        <p className="mt-2 text-center text-xs text-danger">Plan expired — request a new one.</p>
      )}
    </motion.div>
  )
}
