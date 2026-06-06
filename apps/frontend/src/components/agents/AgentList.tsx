import { useState } from 'react'
import { Bot, Loader2, RefreshCw } from 'lucide-react'
import { AgentTable } from './AgentTable'
import type { TwiinAgentInfo } from '@/hooks/useTwiinAgents'
import { useUIStore } from '@/stores/ui'
import { cn } from '@/lib/cn'

function SkeletonRow() {
  return (
    <tr className="border-b border-border/40">
      <td colSpan={6} className="px-3 py-4">
        <div className="flex items-center gap-4">
          <div className="size-8 animate-pulse bg-muted" />
          <div className="h-3 w-48 animate-pulse bg-muted" />
        </div>
      </td>
    </tr>
  )
}

type AgentListProps = {
  agents: TwiinAgentInfo[]
  isLoading: boolean
  error: string | null
  onRefresh: () => void
  onToggleKillSwitch: (agentId: bigint, current: boolean) => Promise<unknown>
}

export function AgentList({
  agents,
  isLoading,
  error,
  onRefresh,
  onToggleKillSwitch,
}: AgentListProps) {
  const [togglingId, setTogglingId] = useState<bigint | null>(null)
  const setSelectedAgentId = useUIStore((s) => s.setSelectedAgentId)

  async function handleToggle(agentId: bigint, current: boolean) {
    setTogglingId(agentId)
    try {
      await onToggleKillSwitch(agentId, current)
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-widest text-primary/80">
          Your Twiins
        </span>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex cursor-pointer items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-primary"
        >
          <RefreshCw size={12} className={cn(isLoading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-3 border border-destructive/30 bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
          {error}
        </div>
      )}

      {isLoading && agents.length === 0 && (
        <div className="overflow-x-auto border border-border">
          <table className="w-full">
            <tbody>
              <SkeletonRow />
              <SkeletonRow />
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && agents.length === 0 && (
        <div className="border border-border py-16 text-center">
          <Bot size={24} className="mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm font-medium text-muted-foreground">No agents yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Deploy your first Twiin from the banner above.
          </p>
        </div>
      )}

      {agents.length > 0 && (
        <>
          {isLoading && (
            <div className="mb-2 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
              <Loader2 size={11} className="animate-spin" />
              Updating…
            </div>
          )}
          <AgentTable
            agents={agents}
            onSelect={setSelectedAgentId}
            onToggleKillSwitch={handleToggle}
            togglingId={togglingId}
          />
        </>
      )}
    </div>
  )
}
