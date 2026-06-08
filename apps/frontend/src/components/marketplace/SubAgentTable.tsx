import { RefreshCw, Users } from 'lucide-react'
import { SubAgentRow } from './SubAgentRow'
import type { SubAgentInfo } from '@/hooks/useSubAgents'
import { cn } from '@/lib/cn'

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 p-4">
      <div className="size-9 animate-pulse bg-muted" />
      <div className="flex flex-1 flex-col gap-2">
        <div className="h-3.5 w-36 animate-pulse bg-muted" />
        <div className="h-2.5 w-52 animate-pulse bg-muted" />
      </div>
    </div>
  )
}

type TableAccent = 'native' | 'external' | 'leaderboard'

type SubAgentTableProps = {
  agents: SubAgentInfo[]
  isLoading: boolean
  error: string | null
  onRefresh: () => void
  showRank?: boolean
  emptyTitle?: string
  emptyHint?: string
  accent?: TableAccent
}

const HEADER_ACCENT: Record<TableAccent, string> = {
  native: 'border-b-primary/25 bg-primary-bright/12 text-primary',
  external: 'border-b-warning/30 bg-warning/10 text-warning',
  leaderboard: 'border-b-primary-bright/40 bg-charcoal text-primary-bright',
}

export function SubAgentTable({
  agents,
  isLoading,
  error,
  onRefresh,
  showRank = true,
  emptyTitle = 'No agents in this lane',
  emptyHint = 'Registry entries appear after deploy or external registration.',
  accent = 'leaderboard',
}: SubAgentTableProps) {
  const headerClass = HEADER_ACCENT[accent]

  return (
    <div>
      <div
        className={cn(
          'flex items-center justify-between gap-2 border-b px-4 py-3 sm:px-5',
          headerClass,
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs font-bold uppercase tracking-widest">
          <span className="hidden w-9 shrink-0 sm:block" />
          <span className="flex-1">Agent</span>
          <span className="hidden w-52 shrink-0 text-center sm:grid sm:grid-cols-3">Stats</span>
          <span className="hidden w-24 shrink-0 text-center sm:block">Trust</span>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className={cn(
            'inline-flex shrink-0 cursor-pointer items-center gap-1 text-xs font-semibold transition-colors',
            accent === 'leaderboard'
              ? 'text-primary-bright/80 hover:text-primary-bright'
              : 'text-current/70 hover:text-current',
          )}
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
          <Users size={28} className="mx-auto mb-4 text-muted-foreground" />
          <p className="text-sm font-medium text-muted-foreground">{emptyTitle}</p>
          <p className="mt-1 text-xs text-muted-foreground">{emptyHint}</p>
        </div>
      )}

      {agents.length > 0 && (
        <div>
          {isLoading && (
            <div className="border-b border-border/40 bg-primary-bright/5 px-4 py-2 text-xs text-primary">
              Updating…
            </div>
          )}
          {agents.map((agent, i) => (
            <SubAgentRow
              key={agent.configId}
              agent={agent}
              rank={i + 1}
              showRank={showRank}
              accent={accent}
            />
          ))}
        </div>
      )}

      {!isLoading && agents.length > 0 && (
        <div className="border-t border-border/40 bg-muted/30 px-4 py-2 text-right text-[10px] text-muted-foreground">
          {agents.length} agent{agents.length === 1 ? '' : 's'} · Elo from on-chain registry (F6)
        </div>
      )}
    </div>
  )
}
