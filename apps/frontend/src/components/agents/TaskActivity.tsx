import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Activity, ExternalLink, ListChecks, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { taskStateLabel, taskStateVariant } from '@/lib/task-state'
import { formatAgentLabel } from '@/lib/agent-name'
import type { TaskInfo } from '@/hooks/useAgentTasks'
import type { TwiinAgentInfo } from '@/hooks/useTwiinAgents'
import { CONTRACTS } from '@/config/contracts'
import { somniaTestnet } from '@/config/chains'
import { cn } from '@/lib/cn'

const EXPLORER = somniaTestnet.blockExplorers.default.url
const ORCHESTRATOR = CONTRACTS.orchestrator.address

function SkeletonRow() {
 return (
 <div className="flex items-center gap-4 p-4">
 <div className="size-9 animate-pulse bg-muted" />
 <div className="flex flex-1 flex-col gap-2">
 <div className="h-3.5 w-28 animate-pulse rounded bg-muted" />
 <div className="h-2.5 w-44 animate-pulse rounded bg-muted" />
 </div>
 </div>
 )
}

type TaskActivityProps = {
 tasks: TaskInfo[]
 agents: TwiinAgentInfo[]
 isLoading: boolean
 error: string | null
 onRefresh: () => void
}

export function TaskActivity({
 tasks,
 agents,
 isLoading,
 error,
 onRefresh,
}: TaskActivityProps) {
 const labelFor = (agentId: string) => {
 const agent = agents.find((a) => a.id.toString() === agentId)
 return agent ? formatAgentLabel(agent.name, agent.id) : `#${agentId}`
 }

 return (
 <div className="overflow-hidden border border-border-strong">
 <div className="flex items-center justify-between border-b border-primary/20 bg-primary-bright/10 px-4 py-3">
 <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary/80">
 <Activity size={12} />
 Task history
 </span>
 <button
 type="button"
 onClick={onRefresh}
 className="inline-flex cursor-pointer items-center gap-1 text-xs font-semibold text-primary/70 hover:text-primary"
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

 {isLoading && tasks.length === 0 && (
 <div className="divide-y divide-border/40">
 {Array.from({ length: 3 }).map((_, i) => (
 <SkeletonRow key={i} />
 ))}
 </div>
 )}

 {!isLoading && tasks.length === 0 && (
 <div className="py-16 text-center">
 <ListChecks size={24} className="mx-auto mb-3 text-muted-foreground" />
 <p className="text-sm font-medium text-muted-foreground">No tasks yet</p>
 <p className="mt-1 text-xs text-muted-foreground">
 Run a task from the Console to see it here.
 </p>
 </div>
 )}

 {tasks.length > 0 && (
 <div className="divide-y divide-border/40">
 {tasks.map((task) => (
 <motion.div
 key={task.taskId}
 layout
 className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
 >
 <div className="flex min-w-0 flex-1 items-center gap-3">
 <div className="flex size-9 shrink-0 items-center justify-center bg-primary/10 text-xs font-bold text-primary">
 #{task.taskId}
 </div>
 <div className="min-w-0">
 <div className="flex flex-wrap items-center gap-2">
 <p className="truncate text-sm font-bold text-foreground">
 {labelFor(task.personalAgentId)}
 </p>
 <Badge variant={taskStateVariant(task.state)}>
 {taskStateLabel(task.state)}
 </Badge>
 </div>
 <p className="mt-0.5 text-[11px] text-muted-foreground">
 step {task.cursor} · {task.spent}/{task.budget} STT spent
 </p>
 </div>
 </div>

 <div className="flex shrink-0 items-center gap-2 sm:justify-end">
 <Link
 to="/console"
 className="inline-flex items-center gap-1 border border-border px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted"
 >
 Console
 </Link>
 <a
 href={`${EXPLORER}/address/${ORCHESTRATOR}`}
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-1 border border-border px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted"
 >
 <ExternalLink size={12} />
 </a>
 </div>
 </motion.div>
 ))}
 </div>
 )}
 </div>
 )
}
