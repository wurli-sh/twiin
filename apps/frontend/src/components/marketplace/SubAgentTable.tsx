import { RefreshCw, Users } from 'lucide-react'
import { SubAgentRow } from './SubAgentRow'
import type { SubAgentInfo } from '@/hooks/useSubAgents'
import { cn } from '@/lib/cn'

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 p-4">
      <div className="size-9 animate-pulse rounded-lg bg-surface-alt" />
      <div className="flex flex-1 flex-col gap-2">
        <div className="h-3.5 w-36 animate-pulse rounded bg-surface-alt" />
        <div className="h-2.5 w-52 animate-pulse rounded bg-surface-alt" />
      </div>
    </div>
  )
}

type SubAgentTableProps = {
  agents: SubAgentInfo[]
  isLoading: boolean
  error: string | null
  onRefresh: () => void
  showRank?: boolean
  emptyTitle?: string
  emptyHint?: string
}

export function SubAgentTable({
  agents,
  isLoading,
  error,
  onRefresh,
  showRank = true,
  emptyTitle = 'No agents in this lane',
  emptyHint = 'Registry entries appear after deploy or external registration.',
}: SubAgentTableProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-alt/60 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs font-medium uppercase tracking-widest text-text-faint">
          <span className="hidden w-9 shrink-0 sm:block" />
          <span className="flex-1">Agent</span>
          <span className="w-52 shrink-0 text-center hidden sm:grid sm:grid-cols-3">Stats</span>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-xs font-semibold text-text-muted hover:text-text"
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
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      )}

      {!isLoading && agents.length === 0 && (
        <div className="py-20 text-center">
          <Users size={28} className="mx-auto mb-4 text-text-faint" />
          <p className="text-sm font-medium text-text-muted">{emptyTitle}</p>
          <p className="mt-1 text-xs text-text-faint">{emptyHint}</p>
        </div>
      )}

      {agents.length > 0 && (
        <div>
          {isLoading && (
            <div className="border-b border-border/40 px-4 py-2 text-xs text-text-faint">
              Updating…
            </div>
          )}
          {agents.map((agent, i) => (
            <SubAgentRow
              key={agent.configId}
              agent={agent}
              rank={i + 1}
              showRank={showRank}
            />
          ))}
        </div>
      )}

      {!isLoading && agents.length > 0 && (
        <div className="border-t border-border/40 bg-surface-alt/40 px-4 py-2 text-right text-[10px] text-text-faint">
          {agents.length} agent{agents.length === 1 ? '' : 's'} · Elo from on-chain registry (F6)
        </div>
      )}
    </div>
  )
}
