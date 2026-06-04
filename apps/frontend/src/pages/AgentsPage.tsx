import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Terminal } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Tabs } from '@/components/ui/Tabs'
import { DeployAgentPanel } from '@/components/agents/DeployAgentPanel'
import { AgentList } from '@/components/agents/AgentList'
import { TaskActivity } from '@/components/agents/TaskActivity'
import { useUIStore } from '@/stores/ui'
import { usePageReady } from '@/hooks/usePageReady'
import { useWallet } from '@/hooks/useWallet'
import { useTwiinAgents } from '@/hooks/useTwiinAgents'
import { useAgentTasks } from '@/hooks/useAgentTasks'

const TABS = [
  { label: 'My Agents', key: 'mine' },
  { label: 'Activity', key: 'activity' },
]

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-surface-alt', className)} />
}

function PageSkeleton() {
  return (
    <div className="pt-16 pb-12">
      <Skeleton className="mb-6 h-8 w-40" />
      <Skeleton className="mb-6 h-4 w-72" />
      <div className="flex flex-col gap-5 lg:flex-row">
        <Skeleton className="h-[420px] w-full shrink-0 rounded-xl lg:w-[360px]" />
        <Skeleton className="h-[420px] flex-1 rounded-xl" />
      </div>
    </div>
  )
}

export function AgentsPage() {
  const ready = usePageReady()
  const { isConnected } = useWallet()
  const {
    agents,
    isLoading,
    error,
    mintAgent,
    toggleKillSwitch,
    refetchAgents,
  } = useTwiinAgents()
  const activeTab = useUIStore((s) => s.activeAgentsTab)
  const setActiveTab = useUIStore((s) => s.setActiveAgentsTab)
  const selectedAgentId = useUIStore((s) => s.selectedAgentId)

  const agentIds = useMemo(() => agents.map((a) => a.id), [agents])
  const {
    tasks,
    isLoading: tasksLoading,
    error: tasksError,
    refetchTasks,
  } = useAgentTasks(agentIds)

  if (!ready) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <PageSkeleton />
      </motion.div>
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
          <h1 className="text-3xl font-bold tracking-tight text-text">Agents</h1>
          <p className="mt-1.5 text-sm text-text-muted">
            Mint named Twiins, fund their 6551 wallets, and manage policy.
          </p>
        </div>
        {selectedAgentId && (
          <Link
            to="/console"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-xs font-bold text-primary"
          >
            <Terminal size={14} />
            Console · Agent #{selectedAgentId}
          </Link>
        )}
      </motion.div>

      <div className="flex flex-col gap-5 lg:flex-row">
        <motion.div
          className="w-full shrink-0 lg:w-[360px]"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
        >
          <DeployAgentPanel
            isConnected={isConnected}
            mintAgent={mintAgent}
            onDeployed={() => void refetchAgents()}
          />
        </motion.div>

        <motion.div
          className="min-w-0 flex-1"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Tabs items={TABS} active={activeTab} onChange={setActiveTab} />

          <div className="mt-4">
            {activeTab === 'mine' && (
              <>
                {!isConnected ? (
                  <div className="overflow-hidden rounded-xl border border-border py-16 text-center">
                    <p className="text-sm font-medium text-text-muted">
                      Connect wallet to view your agents
                    </p>
                  </div>
                ) : (
                  <AgentList
                    agents={agents}
                    isLoading={isLoading}
                    error={error}
                    onRefresh={() => void refetchAgents()}
                    onToggleKillSwitch={toggleKillSwitch}
                  />
                )}
              </>
            )}

            {activeTab === 'activity' && (
              <>
                {!isConnected ? (
                  <div className="overflow-hidden rounded-xl border border-border py-16 text-center">
                    <p className="text-sm font-medium text-text-muted">
                      Connect wallet to view task history
                    </p>
                  </div>
                ) : (
                  <TaskActivity
                    tasks={tasks}
                    agents={agents}
                    isLoading={tasksLoading}
                    error={tasksError}
                    onRefresh={() => void refetchTasks()}
                  />
                )}
              </>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  )
}
