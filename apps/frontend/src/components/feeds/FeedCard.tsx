import { motion } from 'framer-motion'
import { zeroHash } from 'viem'
import { Clock, Radio, RefreshCw, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { formatDuration, formatFeedAge } from '@/lib/format-time'
import type { OracleFeedInfo } from '@/hooks/useOracleFeeds'
import { cn } from '@/lib/cn'

type FeedCardProps = {
  feed: OracleFeedInfo
  agentLabel: string
}

export function FeedCard({ feed, agentLabel }: FeedCardProps) {
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'rounded-xl border p-5',
        feed.stale ? 'border-warning/30 bg-warning/5' : 'border-border bg-surface',
      )}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-xs text-text-faint">{agentLabel}</p>
          <h3 className="mt-0.5 text-sm font-bold text-text">{feed.topic}</h3>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={feed.stale ? 'warning' : 'success'}>
            {feed.stale ? 'Stale' : 'Fresh'}
          </Badge>
          <Badge variant="default">
            <ShieldCheck size={10} className="mr-1 inline" />
            {feed.confidence}% conf
          </Badge>
        </div>
      </div>

      <p className="text-sm leading-relaxed text-text-muted whitespace-pre-wrap break-words">
        {feed.value || '—'}
      </p>

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-alt">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${Math.min(100, feed.confidence)}%` }}
        />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-[11px] sm:grid-cols-4">
        <Meta icon={Clock} label="Updated" value={formatFeedAge(feed.timestamp)} />
        <Meta icon={Radio} label="Max age" value={formatDuration(feed.maxAgeSeconds)} />
        <Meta icon={RefreshCw} label="Refresh" value={formatDuration(feed.refreshInterval)} />
        <div>
          <dt className="text-text-faint uppercase tracking-wider">Template</dt>
          <dd className="mt-0.5 truncate font-mono text-text-muted">
            {feed.taskTemplateHash === zeroHash
              ? '—'
              : `${feed.taskTemplateHash.slice(0, 10)}…`}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-[10px] text-text-faint">
        Read via OracleFeed.getFeed · stale flag from chain (F6)
      </p>
    </motion.article>
  )
}

function Meta({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock
  label: string
  value: string
}) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-text-faint uppercase tracking-wider">
        <Icon size={10} />
        {label}
      </dt>
      <dd className="mt-0.5 font-semibold text-text">{value}</dd>
    </div>
  )
}
