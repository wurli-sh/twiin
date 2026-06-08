import { motion } from 'framer-motion'
import { AlertTriangle, Award, Crown, Globe, Medal, Server, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { TwiinAvatar } from '@/components/ui/TwiinAvatar'
import { cn } from '@/lib/cn'
import { formatAgentLabel } from '@/lib/agent-name'
import {
 getSubAgentStatus,
 statusBadgeVariant,
 statusLabel,
 winRate,
 truncateAddress,
} from '@/lib/sub-agent-status'
import type { SubAgentInfo } from '@/hooks/useSubAgents'

type SubAgentRowProps = {
  agent: SubAgentInfo
  rank: number
  showRank?: boolean
  accent?: 'native' | 'external' | 'leaderboard'
}

function RankBadge({ rank }: { rank: number }) {
 if (rank === 1) {
 return (
 <div className="flex size-9 shrink-0 items-center justify-center bg-rank-gold/15">
 <Crown size={16} className="text-rank-gold" />
 </div>
 )
 }
 if (rank === 2) {
 return (
 <div className="flex size-9 shrink-0 items-center justify-center bg-rank-silver/15">
 <Medal size={16} className="text-rank-silver" />
 </div>
 )
 }
 if (rank === 3) {
 return (
 <div className="flex size-9 shrink-0 items-center justify-center bg-rank-bronze/15">
 <Award size={16} className="text-rank-bronze" />
 </div>
 )
 }
 return (
 <div className="flex size-9 shrink-0 items-center justify-center bg-muted">
 <span className="text-sm font-bold tabular-nums text-muted-foreground">{rank}</span>
 </div>
 )
}

export function SubAgentRow({ agent, rank, showRank = true, accent = 'leaderboard' }: SubAgentRowProps) {
 const status = getSubAgentStatus(agent)
 const isTop3 = rank <= 3
 const label = formatAgentLabel(agent.name, BigInt(agent.configId))
 const wr = winRate(agent)
 const isNative = agent.lane === 'SomniaNative'
 const verificationLabel = isNative
 ? null
 : agent.isVerified
 ? 'Verified'
 : agent.lastError
 ? 'Verify failed'
 : 'Pending verify'

 return (
 <motion.div
 layout
 className={cn(
 'flex flex-col gap-3 border-b border-border/40 px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:gap-4 transition-colors hover:bg-primary-bright/8',
 isTop3 && showRank && accent === 'leaderboard' && 'bg-primary-bright/12',
 isTop3 && showRank && accent === 'native' && 'bg-primary-bright/10',
 isTop3 && showRank && accent === 'external' && 'bg-warning/8',
 )}
 whileHover={{ x: 2 }}
 transition={{ duration: 0.15 }}
 >
 <div className="flex min-w-0 flex-1 items-center gap-3">
 {showRank ? (
 <RankBadge rank={rank} />
 ) : (
 <TwiinAvatar name={agent.name || 'agent'} size="md" />
 )}
 <div className="min-w-0 flex-1">
 <div className="flex flex-wrap items-center gap-2">
 <p className={cn('truncate text-sm font-bold text-foreground', isTop3 && 'text-base')}>
 {label}
 </p>
 <Badge variant={isNative ? 'default' : 'warning'}>
 {isNative ? (
 <span className="inline-flex items-center gap-1">
 <Server size={10} />
 Native
 </span>
 ) : (
 <span className="inline-flex items-center gap-1">
 <Globe size={10} />
 External
 </span>
 )}
 </Badge>
 <Badge variant={statusBadgeVariant(status)}>{statusLabel(status)}</Badge>
 {!isNative && verificationLabel && (
 <Badge variant={agent.isVerified ? 'success' : agent.lastError ? 'danger' : 'warning'}>
 {agent.isVerified ? (
 <span className="inline-flex items-center gap-1">
 <ShieldCheck size={10} />
 {verificationLabel}
 </span>
 ) : (
 <span className="inline-flex items-center gap-1">
 <AlertTriangle size={10} />
 {verificationLabel}
 </span>
 )}
 </Badge>
 )}
 </div>
 <p className="mt-0.5 text-[11px] text-muted-foreground">
 config #{agent.configId}
 {!isNative && agent.registrant && (
 <> · {truncateAddress(agent.registrant)}</>
 )}
 {agent.capabilities.length > 0 && (
 <> · {agent.capabilities.slice(0, 3).join(', ')}</>
 )}
 </p>
 {!isNative && (agent.endpointUrl || agent.lastError) && (
 <p
 className="mt-1 truncate text-[11px] text-muted-foreground"
 title={
 agent.endpointUrl
 ? `${agent.endpointUrl}${agent.lastError ? ` · ${agent.lastError}` : ''}`
 : agent.lastError ?? 'No endpoint cached'
 }
 >
 {agent.endpointUrl ? agent.endpointUrl : 'No endpoint cached'}
 {agent.lastError ? ` · ${agent.lastError}` : ''}
 </p>
 )}
 </div>
 </div>

 <div className="grid grid-cols-3 gap-2 sm:w-52 shrink-0">
 <Stat label="Elo" value={agent.eloScore.toLocaleString()} highlight={isTop3} />
 <Stat label="Cost" value={`${Number(agent.cost).toFixed(3)}`} sub="STT" />
 <Stat label="Win %" value={`${wr}%`} sub={`${agent.tasksCompleted} done`} />
 </div>

 <div className="flex shrink-0 items-center gap-2 sm:w-24 sm:justify-end">
 <Badge variant="default" className="tabular-nums">
 T{agent.trustTier}
 </Badge>
 {agent.avgLatencyMs > 0 && (
 <span className="text-[10px] text-muted-foreground">{agent.avgLatencyMs}ms</span>
 )}
 </div>
 </motion.div>
 )
}

function Stat({
 label,
 value,
 sub,
 highlight,
}: {
 label: string
 value: string
 sub?: string
 highlight?: boolean
}) {
 return (
 <div className="border border-border/60 bg-muted/40 px-2 py-1.5 text-center">
 <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
 <p
 className={cn(
 'text-xs font-bold tabular-nums',
 highlight ? 'text-primary' : 'text-foreground',
 )}
 >
 {value}
 </p>
 {sub && <p className="text-[9px] text-muted-foreground">{sub}</p>}
 </div>
 )
}
