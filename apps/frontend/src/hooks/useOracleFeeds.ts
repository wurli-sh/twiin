import { useState, useEffect, useCallback, useMemo } from 'react'
import { usePublicClient } from 'wagmi'
import { keccak256, toBytes, type Hex, type PublicClient } from 'viem'
import { CONTRACTS, OracleFeedAbi } from '@/config/contracts'
import { readContract } from '@/lib/read-contract'
import { DEMO_FEED_TOPICS } from '@/lib/feed-topics'

export type OracleFeedInfo = {
  topic: string
  value: string
  confidence: number
  timestamp: number
  stale: boolean
  maxAgeSeconds: number
  refreshInterval: number
  taskTemplateHash: Hex
  exists: boolean
}

async function readFeedForTopic(
  publicClient: PublicClient,
  agentId: bigint,
  topic: string,
): Promise<OracleFeedInfo> {
  const topicKey = keccak256(toBytes(topic))

  const [view, meta] = await Promise.all([
    readContract<{
      value: string
      confidence: number
      timestamp: bigint
      stale: boolean
    }>(publicClient, {
      address: CONTRACTS.oracleFeed.address,
      abi: OracleFeedAbi,
      functionName: 'getFeed',
      args: [agentId, topic],
    }),
    readContract<{
      value: string
      confidence: number
      timestamp: bigint
      maxAgeSeconds: bigint
      refreshInterval: bigint
      taskTemplateHash: Hex
    }>(publicClient, {
      address: CONTRACTS.oracleFeed.address,
      abi: OracleFeedAbi,
      functionName: 'feeds',
      args: [agentId, topicKey],
    }),
  ])

  const ts = Number(view.timestamp)
  const exists = ts > 0 || view.value.length > 0

  return {
    topic,
    value: view.value,
    confidence: Number(view.confidence),
    timestamp: ts,
    stale: view.stale,
    maxAgeSeconds: Number(meta.maxAgeSeconds),
    refreshInterval: Number(meta.refreshInterval),
    taskTemplateHash: meta.taskTemplateHash,
    exists,
  }
}

export function useOracleFeeds(agentId: string | null, extraTopics: string[] = []) {
  const publicClient = usePublicClient()
  const [feeds, setFeeds] = useState<OracleFeedInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const topics = useMemo(() => {
    const demo = [...DEMO_FEED_TOPICS]
    const extra = extraTopics.filter(
      (t) => t.trim() && !demo.includes(t.trim() as (typeof DEMO_FEED_TOPICS)[number]),
    )
    return [...demo, ...extra.map((t) => t.trim())]
  }, [extraTopics.join('\n')])

  const loadFeeds = useCallback(async () => {
    if (!publicClient || !agentId) {
      setFeeds([])
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const id = BigInt(agentId)
      const results = await Promise.all(
        topics.map((topic) => readFeedForTopic(publicClient, id, topic)),
      )
      setFeeds(
        results
          .filter((f) => f.exists)
          .sort((a, b) => b.timestamp - a.timestamp),
      )
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to load feeds'
      setError(message)
      setFeeds([])
    } finally {
      setIsLoading(false)
    }
  }, [publicClient, agentId, topics])

  const lookupTopic = useCallback(
    async (topic: string): Promise<OracleFeedInfo | null> => {
      if (!publicClient || !agentId || !topic.trim()) return null
      const feed = await readFeedForTopic(publicClient, BigInt(agentId), topic.trim())
      return feed.exists ? feed : null
    },
    [publicClient, agentId],
  )

  useEffect(() => {
    void loadFeeds()
  }, [loadFeeds])

  return { feeds, isLoading, error, refetchFeeds: loadFeeds, lookupTopic, topics }
}
