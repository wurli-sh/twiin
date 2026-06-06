import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { RefreshCw, Users, Globe, Trophy } from 'lucide-react'
import { Tabs } from '@/components/ui/Tabs'
import { SubAgentTable } from '@/components/marketplace/SubAgentTable'
import { useUIStore } from '@/stores/ui'
import { usePageReady } from '@/hooks/usePageReady'
import { useSubAgents } from '@/hooks/useSubAgents'
import { cn } from '@/lib/cn'

const TABS = [
  { label: 'Native', key: 'native' },
  { label: 'External', key: 'external' },
  { label: 'Leaderboard', key: 'leaderboard' },
]

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse bg-muted', className)} />
}

export function MarketplacePage() {
  const ready = usePageReady()
  const activeTab = useUIStore((s) => s.activeMarketplaceTab)
  const setActiveTab = useUIStore((s) => s.setActiveMarketplaceTab)
  const { subAgents, isLoading, error, refetchSubAgents } = useSubAgents()

  const filtered = useMemo(() => {
    let list = subAgents
    if (activeTab === 'native') {
      list = list.filter((a) => a.lane === 'SomniaNative')
    } else if (activeTab === 'external') {
      list = list.filter((a) => a.lane === 'ExternalHTTP')
    }
    return [...list].sort((a, b) => b.eloScore - a.eloScore)
  }, [subAgents, activeTab])

  const nativeCount = subAgents.filter((a) => a.lane === 'SomniaNative').length
  const externalCount = subAgents.filter((a) => a.lane === 'ExternalHTTP').length
  const topElo = subAgents[0]?.eloScore ?? 0

  const emptyCopy =
    activeTab === 'native'
      ? {
          title: 'No native sub-agents',
          hint: 'Deploy script registers web-intel, oracle, analysis, and reporter lanes.',
        }
      : activeTab === 'external'
        ? {
            title: 'No external competitors yet',
            hint: 'Register yours on the Agents page.',
          }
        : {
            title: 'Registry empty',
            hint: 'Sub-agents rank by on-chain Elo after tasks complete.',
          }

  if (!ready) {
    return (
      <div className="pb-12 pt-6">
        <Skeleton className="mb-6 h-8 w-48" />
        <Skeleton className="h-[360px] w-full" />
      </div>
    )
  }

  return (
    <div className="pb-12 pt-6">
      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Marketplace</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Sub-agent registry on Somnia with backend verification for external HTTP agents.
        </p>
      </motion.div>

      <motion.div
        className="mb-6 grid gap-4 sm:grid-cols-3"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.03 }}
      >
        <div
          className={cn(
            'border p-4 shadow-card transition-colors',
            activeTab === 'native'
              ? 'border-primary/30 bg-primary-bright/20 shadow-active'
              : 'border-primary/15 bg-primary-bright/10',
          )}
        >
          <Users size={18} className="text-primary" />
          <p className="mt-2 text-2xl font-bold text-foreground">{nativeCount}</p>
          <p className="text-xs font-medium text-primary/80">Native agents</p>
        </div>
        <div
          className={cn(
            'border p-4 shadow-card transition-colors',
            activeTab === 'external'
              ? 'border-warning/40 bg-warning/15 shadow-soft'
              : 'border-warning/20 bg-warning/5',
          )}
        >
          <Globe size={18} className="text-warning" />
          <p className="mt-2 text-2xl font-bold text-foreground">{externalCount}</p>
          <p className="text-xs font-medium text-warning">External HTTP</p>
        </div>
        <div
          className={cn(
            'border p-4 shadow-elev transition-colors',
            activeTab === 'leaderboard'
              ? 'border-primary-bright/50 bg-charcoal shadow-lime-pill'
              : 'border-charcoal-soft bg-charcoal text-white',
          )}
        >
          <Trophy size={18} className="text-primary-bright" />
          <p className="mt-2 text-2xl font-bold text-white">{topElo}</p>
          <p className="text-xs font-medium text-primary-bright/80">Top Elo score</p>
        </div>
      </motion.div>

      <motion.div
        className="overflow-hidden border border-border-strong bg-card shadow-card"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
      >
        <Tabs
          items={TABS}
          active={activeTab}
          onChange={setActiveTab}
          layoutId="marketplaceTab"
          className="border-b-2 border-border bg-muted/40"
          trailing={
            <button
              type="button"
              onClick={() => void refetchSubAgents()}
              className="inline-flex cursor-pointer items-center gap-1 px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-primary-bright/15 hover:text-primary"
            >
              <RefreshCw size={12} className={cn(isLoading && 'animate-spin')} />
              Sync
            </button>
          }
        />

        <SubAgentTable
          agents={filtered}
          isLoading={isLoading}
          error={error}
          onRefresh={() => void refetchSubAgents()}
          showRank={activeTab === 'leaderboard'}
          emptyTitle={emptyCopy.title}
          emptyHint={emptyCopy.hint}
          accent={activeTab as 'native' | 'external' | 'leaderboard'}
        />
      </motion.div>
    </div>
  )
}
