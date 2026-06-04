import { useState } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { FeedCard } from './FeedCard'
import type { OracleFeedInfo } from '@/hooks/useOracleFeeds'

type FeedTopicLookupProps = {
  agentLabel: string
  onLookup: (topic: string) => Promise<OracleFeedInfo | null>
  disabled?: boolean
}

export function FeedTopicLookup({ agentLabel, onLookup, disabled }: FeedTopicLookupProps) {
  const [topic, setTopic] = useState('')
  const [result, setResult] = useState<OracleFeedInfo | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSearch() {
    const trimmed = topic.trim()
    if (!trimmed) return
    setLoading(true)
    setNotFound(false)
    setResult(null)
    try {
      const feed = await onLookup(trimmed)
      if (feed) {
        setResult(feed)
      } else {
        setNotFound(true)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface-alt/40 p-4">
      <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-text-faint">
        Lookup custom topic
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="somnia.ecosystem.health"
          disabled={disabled || loading}
          className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 font-mono text-sm text-text outline-none placeholder:text-text-faint focus:border-primary/40 disabled:opacity-50"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSearch()
          }}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={disabled || loading || !topic.trim()}
          onClick={() => void handleSearch()}
        >
          <Search size={14} />
          {loading ? '…' : 'Query'}
        </Button>
      </div>
      {notFound && (
        <p className="mt-2 text-xs text-text-faint">No feed published for this topic yet.</p>
      )}
      {result && (
        <div className="mt-4">
          <FeedCard feed={result} agentLabel={agentLabel} />
        </div>
      )}
    </div>
  )
}
