import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Shield, Terminal } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Tabs } from '@/components/ui/Tabs'
import { AddAgentPanel } from '@/components/agents/AddAgentPanel'
import { AgentList } from '@/components/agents/AgentList'
import { TaskActivity } from '@/components/agents/TaskActivity'
import { PolicyPanel } from '@/components/agents/PolicyPanel'
import { useUIStore } from '@/stores/ui'
import { usePageReady } from '@/hooks/usePageReady'
import { useWallet } from '@/hooks/useWallet'
import { useTwiinAgents } from '@/hooks/useTwiinAgents'
import { useAgentTasks } from '@/hooks/useAgentTasks'
import { useSubAgents } from '@/hooks/useSubAgents'

const TABS = [
  { label: 'My Agents', key: 'mine' },
  { label: 'Activity', key: 'activity' },
]

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse bg-muted', className)} />
}

function SelectAgentPlaceholder() {
  return (
    <div className="border border-primary/15 bg-primary-bright/10 p-5 shadow-card lg:min-h-[320px]">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex size-8 items-center justify-center bg-primary/12 text-primary">
          <Shield size={16} />
        </div>
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
            Policy
          </p>
          <h3 className="text-sm font-semibold text-foreground">Select an agent</h3>
        </div>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Choose a row in <span className="font-medium text-foreground">My Agents</span> to edit
        spend caps and refresh pull settings here.
      </p>
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="pb-12 pt-6">
      <Skeleton className="mb-6 h-8 w-40" />
      <Skeleton className="mb-6 h-4 w-72" />
      <div className="mb-6 flex gap-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
      </div>
      <Skeleton className="mb-6 h-16 w-full" />
      <Skeleton className="mb-4 h-10 w-48" />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Skeleton className="h-[420px] w-full" />
        <Skeleton className="h-[420px] w-full" />
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
  const selectedAgent = useMemo(
    () => agents.find((a) => a.id.toString() === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  )
  const {
    tasks,
    isLoading: tasksLoading,
    error: tasksError,
    refetchTasks,
  } = useAgentTasks(agentIds)
  const { subAgents, refetchSubAgents } = useSubAgents()

  if (!ready) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <PageSkeleton />
      </motion.div>
    )
  }

  return (
    <div className="pb-12 pt-6">
      <motion.div
        className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-start"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Agents</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Mint named Twiins, fund their 6551 wallets, and manage policy.
          </p>
        </div>
      </motion.div>

      <motion.div
        className="mb-6 flex flex-wrap gap-2"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.03 }}
      >
        <span className="border border-primary/20 bg-primary-bright/15 px-3 py-1.5 text-xs font-semibold text-primary shadow-soft">
          {agents.length} agent{agents.length === 1 ? '' : 's'}
        </span>
        <span className="border border-border-strong bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-card">
          {tasks.length} task{tasks.length === 1 ? '' : 's'}
        </span>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
      >
        <AddAgentPanel
          isConnected={isConnected}
          mintAgent={mintAgent}
          onDeployed={() => void refetchAgents()}
          subAgents={subAgents}
          onExternalUpdated={() => void refetchSubAgents()}
        />
      </motion.div>

      <motion.div
        className="mb-4"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
      >
        <Tabs items={TABS} active={activeTab} onChange={setActiveTab} layoutId="agentsTab" />
      </motion.div>

      {activeTab === 'mine' && (
        <motion.div
          className="grid gap-4 lg:grid-cols-[2fr_1fr] lg:items-start"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <section className="min-w-0 overflow-hidden border border-border bg-card shadow-card sm:p-5 p-3">
            {!isConnected ? (
              <div className="border border-border py-16 text-center">
                <p className="text-sm font-medium text-muted-foreground">
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
          </section>

          <aside className="min-w-0 lg:sticky lg:top-6">
            {selectedAgent ? (
              <PolicyPanel
                agent={selectedAgent}
                onUpdated={() => void refetchAgents()}
                onToggleKillSwitch={toggleKillSwitch}
              />
            ) : (
              <SelectAgentPlaceholder />
            )}
          </aside>
        </motion.div>
      )}

      {activeTab === 'activity' && (
        <motion.section
          className="overflow-hidden border border-border bg-card shadow-card"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          {!isConnected ? (
            <div className="py-16 text-center">
              <p className="text-sm font-medium text-muted-foreground">
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
        </motion.section>
      )}
    </div>
  )
}
