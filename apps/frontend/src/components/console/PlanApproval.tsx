import { useEffect, useState, useRef, useMemo } from 'react'
import { AlertTriangle, Check, Clock, Loader2, X } from 'lucide-react'
import { formatEther } from 'viem'
import { Button } from '@/components/ui/Button'
import { PlanStepList } from './PlanStepList'
import type { PlanResponse } from '@/lib/plan-api'
import type { TwiinAgentInfo } from '@/hooks/useTwiinAgents'
import type { PlanStatus } from '@/lib/console-session'
import type { ExecutionMode } from '@/config/features'
import { consolePageTheme } from '@/lib/execution-mode-theme'
import { cn } from '@/lib/cn'

const APPROVAL_SECONDS = 60

type PlanApprovalProps = {
  plan: PlanResponse
  goal: string
  agent: TwiinAgentInfo
  status?: PlanStatus
  executionMode?: ExecutionMode
  onApprove: () => Promise<void>
  onReject: (reason: 'user' | 'expired') => void
  isSubmitting: boolean
}

export function PlanApproval({
  plan,
  goal,
  agent,
  status = 'pending',
  executionMode = 'claude',
  onApprove,
  onReject,
  isSubmitting,
}: PlanApprovalProps) {
  const modeTheme = consolePageTheme()
  const [secondsLeft, setSecondsLeft] = useState(APPROVAL_SECONDS)
  const expiredRef = useRef(false)

  useEffect(() => {
    if (status !== 'pending') return
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
  }, [plan, status])

  useEffect(() => {
    if (status !== 'pending' || secondsLeft !== 0 || expiredRef.current) return
    expiredRef.current = true
    onReject('expired')
  }, [secondsLeft, onReject, status])

  const pct = (secondsLeft / APPROVAL_SECONDS) * 100
  const expired = secondsLeft === 0
  const estStt = Number(formatEther(BigInt(plan.estimatedCostWei))).toFixed(4)
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

  if (status === 'approved') {
    return (
      <div className={cn('px-3 py-2.5 text-sm', modeTheme.statusBar)}>
        Plan approved · {plan.steps.length} steps · {estStt} STT est.
      </div>
    )
  }

  if (status === 'rejected' || status === 'expired') {
    return (
      <div className="border border-border-strong bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
        Plan {status === 'expired' ? 'expired' : 'rejected'} — send a new goal to continue.
      </div>
    )
  }

  return (
    <div className={cn('max-w-[92%] overflow-hidden', modeTheme.agentCard)}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">Ready to execute</p>
            {plan.verificationTier === 'corroborated' ? (
              <span className="rounded border border-success/30 bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
                Corroborated
              </span>
            ) : null}
          </div>
          <p className="truncate text-sm text-muted-foreground">{goal}</p>
        </div>
        <div
          className={cn(
            'flex shrink-0 items-center gap-1 px-2 py-0.5 text-xs font-bold tabular-nums',
            secondsLeft <= 10
              ? 'bg-destructive/15 text-destructive'
              : cn(modeTheme.badge, 'font-bold'),
          )}
        >
          <Clock size={12} />
          {secondsLeft}s
        </div>
      </div>

      <div className="h-px bg-muted">
        <div
          className={cn(
            'h-full transition-all duration-1000 ease-linear',
            secondsLeft <= 10
              ? 'bg-destructive'
              : 'bg-[var(--mode-trustless-accent)]',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="px-3 py-2.5">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Planned steps
        </p>
        <PlanStepList steps={plan.steps} executionMode={executionMode} compact />
      </div>

      <div className="flex gap-2 border-t border-border px-3 py-2 text-sm text-muted-foreground">
        <span>
          est <strong className="text-foreground">{estStt}</strong>
        </span>
        <span>
          budget <strong className="text-foreground">{budgetStt.toFixed(2)}</strong>
        </span>
        <span>{plan.steps.length} steps</span>
      </div>

      {blockReason && (
        <p className="mx-3 mb-2 flex items-start gap-1.5 border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-sm text-destructive">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {blockReason}
        </p>
      )}

      <div className="flex gap-1.5 border-t border-border p-2">
        <Button
          type="button"
          size="sm"
          className="h-9 flex-1 text-sm"
          disabled={expired || isSubmitting || Boolean(blockReason)}
          onClick={() => void onApprove()}
        >
          {isSubmitting ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Signing…
            </>
          ) : (
            <>
              <Check size={14} />
              Approve
            </>
          )}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9 text-sm"
          disabled={isSubmitting}
          onClick={() => onReject('user')}
        >
          <X size={14} />
          Reject
        </Button>
      </div>
    </div>
  )
}
