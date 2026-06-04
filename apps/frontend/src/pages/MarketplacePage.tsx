import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { RefreshCw } from 'lucide-react'
import { Tabs } from '@/components/ui/Tabs'
import { ExternalAgentPanel } from '@/components/marketplace/ExternalAgentPanel'
import { SubAgentTable } from '@/components/marketplace/SubAgentTable'
import { useUIStore } from '@/stores/ui'
import { usePageReady } from '@/hooks/usePageReady'
import { useSubAgents } from '@/hooks/useSubAgents'
import { useWallet } from '@/hooks/useWallet'
import { cn } from '@/lib/cn'

const TABS = [
  { label: 'Native', key: 'native' },
  { label: 'External', key: 'external' },
  { label: 'Leaderboard', key: 'leaderboard' },
]

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-surface-alt', className)} />
}

export function MarketplacePage() {
  const ready = usePageReady()
  const { isConnected } = useWallet()
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

  const emptyCopy =
    activeTab === 'native'
      ? {
          title: 'No native sub-agents',
          hint: 'Deploy script registers web-intel, oracle, analysis, and reporter lanes.',
        }
      : activeTab === 'external'
        ? {
            title: 'No external competitors yet',
            hint: 'Register an HTTP agent on-chain (e.g. discord-bot@twiin) to appear here.',
          }
        : {
            title: 'Registry empty',
            hint: 'Sub-agents rank by on-chain Elo after tasks complete.',
          }

  if (!ready) {
    return (
      <div className="pt-16 pb-12">
        <Skeleton className="mb-6 h-8 w-48" />
        <Skeleton className="h-[360px] w-full rounded-xl" />
      </div>
    )
  }

  return (
    <div className="pt-16 pb-12">
      <motion.div
        className="mb-6"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-3xl font-bold tracking-tight text-text">Marketplace</h1>
        <p className="mt-1.5 text-sm text-text-muted">
          Sub-agent registry on Somnia with backend verification state for external HTTP agents.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
      >
        <Tabs
          items={TABS}
          active={activeTab}
          onChange={setActiveTab}
          trailing={
            <button
              type="button"
              onClick={() => void refetchSubAgents()}
              className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-text-muted hover:bg-surface-alt hover:text-text"
            >
              <RefreshCw size={12} className={cn(isLoading && 'animate-spin')} />
              Sync
            </button>
          }
        />

        <div className="mt-4 space-y-4">
          {activeTab === 'external' && (
            <ExternalAgentPanel
              agents={subAgents}
              onUpdated={() => void refetchSubAgents()}
            />
          )}

          <SubAgentTable
            agents={filtered}
            isLoading={isLoading}
            error={error}
            onRefresh={() => void refetchSubAgents()}
            showRank={activeTab === 'leaderboard'}
            emptyTitle={emptyCopy.title}
            emptyHint={
              activeTab === 'external' && !isConnected
                ? 'Connect wallet to register an HTTP agent, or refresh to inspect existing competitors.'
                : emptyCopy.hint
            }
          />
        </div>
      </motion.div>
    </div>
  )
}
