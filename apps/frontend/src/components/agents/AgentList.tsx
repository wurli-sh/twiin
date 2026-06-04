import { useState } from 'react'
import { Bot, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { AgentRow } from './AgentRow'
import type { TwiinAgentInfo } from '@/hooks/useTwiinAgents'
import { useUIStore } from '@/stores/ui'
import { cn } from '@/lib/cn'

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 p-4">
      <div className="size-10 animate-pulse rounded-xl bg-surface-alt" />
      <div className="flex flex-1 flex-col gap-2">
        <div className="h-3.5 w-32 animate-pulse rounded bg-surface-alt" />
        <div className="h-2.5 w-48 animate-pulse rounded bg-surface-alt" />
      </div>
    </div>
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
      toast.success(current ? 'Agent enabled' : 'Agent frozen')
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between border-b border-border bg-surface-alt/60 px-4 py-3">
        <span className="text-xs font-medium uppercase tracking-widest text-text-faint">
          Your Twiins
        </span>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex cursor-pointer items-center gap-1 text-xs font-semibold text-text-muted hover:text-text"
        >
          <RefreshCw size={12} className={cn(isLoading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="border-b border-danger/20 bg-danger/5 px-4 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      {isLoading && agents.length === 0 && (
        <div className="divide-y divide-border/40">
          {Array.from({ length: 2 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      )}

      {!isLoading && agents.length === 0 && (
        <div className="py-16 text-center">
          <Bot size={24} className="mx-auto mb-3 text-text-faint" />
          <p className="text-sm font-medium text-text-muted">No agents yet</p>
          <p className="mt-1 text-xs text-text-faint">
            Deploy your first Twiin from the panel on the left.
          </p>
        </div>
      )}

      {agents.length > 0 && (
        <div>
          {isLoading && (
            <div className="flex items-center gap-2 border-b border-border/40 px-4 py-2 text-xs text-text-faint">
              <Loader2 size={12} className="animate-spin" />
              Updating…
            </div>
          )}
          {agents.map((agent) => (
            <AgentRow
              key={agent.id.toString()}
              agent={agent}
              onSelect={setSelectedAgentId}
              onToggleKillSwitch={handleToggle}
              togglingId={togglingId}
            />
          ))}
        </div>
      )}
    </div>
  )
}
