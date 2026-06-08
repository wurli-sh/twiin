import { ListChecks, SquarePen } from 'lucide-react'
import type { TwiinAgentInfo } from '@/hooks/useTwiinAgents'
import { AgentSelector } from '@/components/console/AgentSelector'
import { BudgetWarningsBar } from '@/components/console/BudgetWarningsBar'
import { cn } from '@/lib/cn'

type Props = {
  hasActivity: boolean
  agents: TwiinAgentInfo[]
  agentId: string | null
  agent: TwiinAgentInfo | undefined
  agentsLoading: boolean
  onSelectAgent: (id: string) => void
  onNewSession?: () => void
  lowBalance: boolean
  overPerTaskCap: boolean
  overDailyCap: boolean
  dailyRemaining: number
  maxPerTaskNum: number
  onRaiseCaps?: () => void
  isRaisingCaps?: boolean
  modeToggleDisabled?: boolean
  agentSelectorDisabled?: boolean
  showStepsToggle?: boolean
  stepsToggleActive?: boolean
  stepProgressLabel?: string | null
  onStepsToggle?: () => void
}

export function ConsoleTopBar({
  hasActivity,
  agents,
  agentId,
  agent,
  agentsLoading,
  onSelectAgent,
  onNewSession,
  lowBalance,
  overPerTaskCap,
  overDailyCap,
  dailyRemaining,
  maxPerTaskNum,
  onRaiseCaps,
  isRaisingCaps = false,
  agentSelectorDisabled = false,
  showStepsToggle = false,
  stepsToggleActive = false,
  stepProgressLabel = null,
  onStepsToggle,
}: Props) {
  return (
    <div className="sticky top-0 z-30 shrink-0 border-b border-border/80 bg-background/95 pb-2 backdrop-blur-sm">
      <div className="flex min-h-[44px] items-center justify-between gap-2 pt-2.5">
        <div className="min-w-0">
          {hasActivity && onNewSession ? (
            <button
              type="button"
              onClick={onNewSession}
              className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:bg-primary-bright/10 hover:text-primary"
            >
              <SquarePen size={12} />
              New Session
            </button>
          ) : (
            <span className="px-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70">
              Console
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {showStepsToggle && onStepsToggle && (
            <button
              type="button"
              onClick={onStepsToggle}
              aria-pressed={stepsToggleActive}
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                stepsToggleActive
                  ? 'border-primary/40 bg-primary-bright/15 text-primary'
                  : 'border-border-strong text-muted-foreground hover:border-primary hover:bg-primary-bright/10 hover:text-primary',
              )}
            >
              <ListChecks size={12} />
              <span className="hidden sm:inline">Steps</span>
              {stepProgressLabel && (
                <span className="rounded bg-muted px-1 py-px font-mono text-[10px] tabular-nums">
                  {stepProgressLabel}
                </span>
              )}
            </button>
          )}

          <div
            className={cn(
              'hidden min-h-[32px] min-w-[140px] items-center gap-2 rounded-md border border-border-strong px-3 py-1.5 text-xs sm:flex',
              !agent && 'border-transparent bg-transparent',
            )}
            aria-hidden={!agent}
          >
            {agent ? (
              <>
                <div className="flex items-center gap-1.5">
                  <div
                    className={cn(
                      'size-1.5 rounded-full',
                      Number(agent.tbaBalance) > 0 ? 'bg-success' : 'bg-destructive',
                    )}
                  />
                  <span className="font-medium tabular-nums text-foreground">
                    {agent.tbaBalance} STT
                  </span>
                </div>
                <div className="h-3 w-px bg-border-strong" />
                <span className="text-muted-foreground">
                  {dailyRemaining.toFixed(2)} STT daily left
                </span>
              </>
            ) : (
              <span className="invisible tabular-nums">0.00 STT</span>
            )}
          </div>

          <AgentSelector
            agents={agents}
            selectedId={agentId}
            onSelect={onSelectAgent}
            loading={agentsLoading}
            disabled={agentSelectorDisabled}
            compact={hasActivity}
          />
        </div>
      </div>

      <div className="mt-2 min-h-[40px]">
        <BudgetWarningsBar
          agent={agent}
          lowBalance={lowBalance}
          overPerTaskCap={overPerTaskCap}
          overDailyCap={overDailyCap}
          dailyRemaining={dailyRemaining}
          perTaskCapStt={maxPerTaskNum > 0 ? maxPerTaskNum.toFixed(2) : undefined}
          onRaiseCaps={onRaiseCaps}
          isRaisingCaps={isRaisingCaps}
        />
      </div>
    </div>
  )
}
