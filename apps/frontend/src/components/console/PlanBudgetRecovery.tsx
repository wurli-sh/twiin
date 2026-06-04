import { AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { maxTaskBudgetStt, policyAllowsBudget } from '@/lib/agent-budget'
import type { TwiinAgentInfo } from '@/hooks/useTwiinAgents'

export type PlanBudgetMismatch = {
  estimatedStt: number
  budgetStt: number
}

type PlanBudgetRecoveryProps = {
  agent: TwiinAgentInfo
  mismatch: PlanBudgetMismatch
  isRaisingCaps: boolean
  onSetBudgetAndRetry: (budgetStt: string) => void
  onRaiseCapsAndRetry: (estimatedStt: number) => void
  onDismiss: () => void
}

export function PlanBudgetRecovery({
  agent,
  mismatch,
  isRaisingCaps,
  onSetBudgetAndRetry,
  onRaiseCapsAndRetry,
  onDismiss,
}: PlanBudgetRecoveryProps) {
  const { estimatedStt, budgetStt } = mismatch
  const maxAffordable = maxTaskBudgetStt(agent)
  const needsPolicy =
    estimatedStt > Number(agent.maxPerTask) || estimatedStt > maxAffordable
  const suggestedCap = Math.ceil(estimatedStt * 10) / 10 + 0.5
  const suggestedDaily = Math.max(suggestedCap * 2, 5)

  return (
    <div className="rounded-xl border border-warning/40 bg-warning/5 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-sm font-semibold text-text">Plan exceeds your budget</p>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              Claude estimated <strong className="text-text">{estimatedStt.toFixed(2)} STT</strong>{' '}
              for this goal, but you asked for{' '}
              <strong className="text-text">{budgetStt.toFixed(2)} STT</strong>. Current limits:
              per-task {agent.maxPerTask} STT, daily remaining{' '}
              {(Number(agent.dailyCap) - Number(agent.dailySpent)).toFixed(2)} STT, wallet{' '}
              {agent.tbaBalance} STT.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {needsPolicy ? (
              <Button
                type="button"
                className="text-xs"
                disabled={isRaisingCaps}
                onClick={() => onRaiseCapsAndRetry(estimatedStt)}
              >
                {isRaisingCaps ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Raising caps…
                  </>
                ) : (
                  `Raise caps (${suggestedCap} STT/task) & retry`
                )}
              </Button>
            ) : (
              <Button
                type="button"
                className="text-xs"
                onClick={() =>
                  onSetBudgetAndRetry(
                    Math.min(estimatedStt, maxAffordable).toFixed(2),
                  )
                }
              >
                Set budget to {Math.min(estimatedStt, maxAffordable).toFixed(2)} STT & retry
              </Button>
            )}

            {!needsPolicy && policyAllowsBudget(agent, 0.75) && (
              <Button
                type="button"
                variant="secondary"
                className="text-xs"
                onClick={() => onSetBudgetAndRetry('0.75')}
              >
                Retry simpler plan (0.75 STT)
              </Button>
            )}

            <Button type="button" variant="outline" className="text-xs" onClick={onDismiss}>
              Dismiss
            </Button>
          </div>

          {needsPolicy && (
            <p className="text-[11px] text-text-faint">
              Or open Agents → expand your agent → Policy and set max per task to at least{' '}
              {suggestedCap} STT and daily cap to {suggestedDaily} STT, fund the 6551 wallet, then
              set task budget to {estimatedStt.toFixed(2)} STT.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
