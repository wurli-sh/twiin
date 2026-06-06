import type { TwiinAgentInfo } from '@/hooks/useTwiinAgents'
import { cn } from '@/lib/cn'

type Props = {
  agent: TwiinAgentInfo | undefined
  lowBalance: boolean
  overPerTaskCap: boolean
  overDailyCap: boolean
  dailyRemaining: number
  perTaskCapStt?: string
  className?: string
}

type WarningItem = {
  text: string
  severity: 'warning' | 'destructive'
}

export function BudgetWarningsBar({
  agent,
  lowBalance,
  overPerTaskCap,
  overDailyCap,
  dailyRemaining,
  perTaskCapStt,
  className,
}: Props) {
  const capLabel = perTaskCapStt ?? agent.maxPerTask
  if (!agent) return null

  const items: WarningItem[] = []

  if (lowBalance) {
    items.push({
      text: `6551 wallet only has ${agent.tbaBalance} STT — fund the agent or lower budget`,
      severity: 'warning',
    })
  }
  if (overPerTaskCap) {
    items.push({
      text: `Budget exceeds per-task cap (${capLabel} STT)`,
      severity: 'destructive',
    })
  }
  if (overDailyCap && !overPerTaskCap) {
    items.push({
      text: `Daily cap — ${dailyRemaining.toFixed(2)} STT left`,
      severity: 'destructive',
    })
  }
  if (agent.killSwitch) {
    items.push({
      text: 'Kill switch is ON — enable your agent on the Agents page',
      severity: 'destructive',
    })
  }

  if (items.length === 0) return null

  const hasDestructive = items.some((item) => item.severity === 'destructive')

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2',
        hasDestructive
          ? 'border-destructive/30 bg-destructive/5'
          : 'border-warning/30 bg-warning/5',
        className,
      )}
    >
      <ul className="flex min-w-0 flex-1 flex-col gap-0.5">
        {items.map((item) => (
          <li
            key={item.text}
            className={`text-xs leading-snug ${
              item.severity === 'destructive' ? 'text-destructive' : 'text-warning'
            }`}
          >
            {item.text}
          </li>
        ))}
      </ul>
    </div>
  )
}
