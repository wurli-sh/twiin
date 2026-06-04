import { useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Database, Loader2, Radio, RefreshCw, Terminal } from 'lucide-react'
import { Tabs } from '@/components/ui/Tabs'
import { AgentSelector } from '@/components/console/AgentSelector'
import { FeedCard } from '@/components/feeds/FeedCard'
import { FeedTopicLookup } from '@/components/feeds/FeedTopicLookup'
import { DEMO_FEED_TOPICS } from '@/lib/feed-topics'
import { formatAgentLabel } from '@/lib/agent-name'
import { usePageReady } from '@/hooks/usePageReady'
import { useWallet } from '@/hooks/useWallet'
import { useTwiinAgents } from '@/hooks/useTwiinAgents'
import { useOracleFeeds } from '@/hooks/useOracleFeeds'
import { useUIStore } from '@/stores/ui'
import { CONTRACTS } from '@/config/contracts'
import { somniaTestnet } from '@/config/chains'
import { cn } from '@/lib/cn'

const TABS = [
  { label: 'Published', key: 'published' },
  { label: 'Lookup', key: 'lookup' },
]

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-surface-alt', className)} />
}

export function FeedsPage() {
  const ready = usePageReady()
  const { isConnected } = useWallet()
  const { agents, isLoading: agentsLoading } = useTwiinAgents()
  const selectedAgentId = useUIStore((s) => s.selectedAgentId)
  const setSelectedAgentId = useUIStore((s) => s.setSelectedAgentId)
  const activeTab = useUIStore((s) => s.activeFeedsTab)
  const setActiveTab = useUIStore((s) => s.setActiveFeedsTab)

  const agentId = selectedAgentId ?? agents[0]?.id.toString() ?? null
  const agent = agents.find((a) => a.id.toString() === agentId)
  const agentLabel = agent ? formatAgentLabel(agent.name, agent.id) : 'Agent'

  const { feeds, isLoading, error, refetchFeeds, lookupTopic } = useOracleFeeds(agentId)

  useEffect(() => {
    if (!selectedAgentId && agents[0]) {
      setSelectedAgentId(agents[0].id.toString())
    }
  }, [agents, selectedAgentId, setSelectedAgentId])

  const explorerOracle = useMemo(
    () => `${somniaTestnet.blockExplorers.default.url}/address/${CONTRACTS.oracleFeed.address}`,
    [],
  )

  if (!ready) {
    return (
      <div className="pt-16 pb-12">
        <Skeleton className="mb-6 h-8 w-48" />
        <Skeleton className="h-[400px] w-full rounded-xl" />
      </div>
    )
  }

  return (
    <div className="pt-16 pb-12">
      <motion.div
        className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-start"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-text">Oracle Feeds</h1>
          <p className="mt-1.5 max-w-xl text-sm text-text-muted">
            Consensus feeds published by your Twiin after tasks complete. TTL, staleness, and
            confidence are read on-chain from{' '}
            <a
              href={explorerOracle}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              OracleFeed
            </a>
            .
          </p>
        </div>
        {agentId && (
          <Link
            to="/console"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-xs font-bold text-primary"
          >
            <Terminal size={14} />
            Run task for {agentLabel}
          </Link>
        )}
      </motion.div>

      {!isConnected ? (
        <div className="overflow-hidden rounded-xl border border-border py-20 text-center">
          <Database size={28} className="mx-auto mb-4 text-text-faint" />
          <p className="text-sm font-medium text-text-muted">
            Connect wallet to inspect feeds for your agents
          </p>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="space-y-5"
        >
          <AgentSelector
            agents={agents}
            selectedId={agentId}
            onSelect={setSelectedAgentId}
            disabled={agentsLoading}
          />

          <Tabs
            items={TABS}
            active={activeTab}
            onChange={setActiveTab}
            trailing={
              <button
                type="button"
                onClick={() => void refetchFeeds()}
                disabled={!agentId || isLoading}
                className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-text-muted hover:bg-surface-alt hover:text-text disabled:opacity-50"
              >
                <RefreshCw size={12} className={cn(isLoading && 'animate-spin')} />
                Sync
              </button>
            }
          />

          <div className="rounded-xl border border-border/60 bg-surface-alt/30 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-text-faint">
              Auto-scan topics
            </p>
            <p className="mt-1 font-mono text-xs text-text-muted">
              {DEMO_FEED_TOPICS.join(' · ')}
            </p>
          </div>

          {error && (
            <div className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-2 text-xs text-danger">
              {error}
            </div>
          )}

          {activeTab === 'published' && (
            <>
              {isLoading && feeds.length === 0 && (
                <div className="flex flex-col items-center py-16">
                  <Loader2 size={24} className="animate-spin text-primary" />
                  <p className="mt-3 text-sm text-text-muted">Reading OracleFeed on Somnia…</p>
                </div>
              )}

              {!isLoading && feeds.length === 0 && !error && (
                <div className="overflow-hidden rounded-xl border border-border py-16 text-center">
                  <Radio size={28} className="mx-auto mb-4 text-text-faint" />
                  <p className="text-sm font-medium text-text-muted">
                    No published feeds for this agent yet
                  </p>
                  <p className="mt-1 text-xs text-text-faint">
                    Complete a task that ends with oracle.publish (e.g. ecosystem health).
                  </p>
                  <Link
                    to="/console"
                    className="mt-4 inline-flex text-xs font-bold text-primary hover:underline"
                  >
                    Open Console →
                  </Link>
                </div>
              )}

              {feeds.length > 0 && (
                <div className="grid gap-4 lg:grid-cols-2">
                  {feeds.map((feed) => (
                    <FeedCard key={feed.topic} feed={feed} agentLabel={agentLabel} />
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === 'lookup' && (
            <FeedTopicLookup
              agentLabel={agentLabel}
              onLookup={lookupTopic}
              disabled={!agentId || agentsLoading}
            />
          )}
        </motion.div>
      )}
    </div>
  )
}
