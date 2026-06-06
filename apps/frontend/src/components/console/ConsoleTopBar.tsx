import { SquarePen } from 'lucide-react'
import { ENABLE_TRUSTLESS_JANICE, type ExecutionMode } from '@/config/features'
import type { TwiinAgentInfo } from '@/hooks/useTwiinAgents'
import { AgentSelector } from '@/components/console/AgentSelector'
import { ExecutionModeToggle } from '@/components/console/ExecutionModeToggle'
import { BudgetWarningsBar } from '@/components/console/BudgetWarningsBar'
import { cn } from '@/lib/cn'

type Props = {
  hasActivity: boolean
  executionMode: ExecutionMode
  onExecutionModeChange: (mode: ExecutionMode) => void
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
  modeToggleDisabled?: boolean
  agentSelectorDisabled?: boolean
}

export function ConsoleTopBar({
  hasActivity,
  executionMode,
  onExecutionModeChange,
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
  modeToggleDisabled = false,
  agentSelectorDisabled = false,
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
          {ENABLE_TRUSTLESS_JANICE && (
            <ExecutionModeToggle
              mode={executionMode}
              onChange={onExecutionModeChange}
              compact={hasActivity}
              disabled={modeToggleDisabled}
            />
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
        />
      </div>
    </div>
  )
}
