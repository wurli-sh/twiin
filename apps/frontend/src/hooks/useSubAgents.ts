import { useState, useEffect, useCallback } from 'react'
import { usePublicClient } from 'wagmi'
import { formatEther, type Address, type Hex } from 'viem'
import { CONTRACTS, AgentRegistryAbi, CapabilityId } from '@/config/contracts'
import { readContract } from '@/lib/read-contract'

export interface SubAgentInfo {
  configId: number
  name: string
  lane: 'SomniaNative' | 'ExternalHTTP'
  cost: string
  eloScore: number
  isActive: boolean
  suspended: boolean
  tasksCompleted: number
  tasksFailed: number
  avgLatencyMs: number
  trustTier: number
  capabilities: string[]
  somniaAgentId?: string
  registrant?: Address
  endpointHash?: Hex
  depositWei?: string
}

// Reverse mapping for capability bytes32 hashes to clean strings
const CAPABILITY_NAME_MAP: Record<string, string> = {
  [CapabilityId.WEB_SCRAPE]: 'web.scrape',
  [CapabilityId.WEB_SCRAPE_DISCORD]: 'web.scrape.discord',
  [CapabilityId.JSON_FETCH]: 'json.fetch',
  [CapabilityId.LLM_ANALYZE]: 'llm.analyze',
  [CapabilityId.LLM_REPORT]: 'llm.report',
  [CapabilityId.DATA_SPECIALIZED]: 'data.specialized',
  [CapabilityId.ORACLE_PUBLISH]: 'oracle.publish',
  [CapabilityId.ONCHAIN_EXECUTE]: 'onchain.execute',
  [CapabilityId.PLAN_TRUSTLESS]: 'plan.trustless',
}

export function useSubAgents() {
  const publicClient = usePublicClient()
  const [subAgents, setSubAgents] = useState<SubAgentInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadSubAgents = useCallback(async () => {
    if (!publicClient) return
    setIsLoading(true)
    setError(null)
    try {
      // 1. Read nextConfigId to find total external configurations
      const nextConfigId = await readContract<bigint>(publicClient, {
        address: CONTRACTS.agentRegistry.address,
        abi: AgentRegistryAbi,
        functionName: 'nextConfigId',
      })

      const total = Number(nextConfigId)
      const list: SubAgentInfo[] = []

      // Native agents are config 0-5. External agents start at 6.
      // Fetch details for all configs (up to a reasonable limit)
      const promises = Array.from({ length: total }, (_, i) => i).map(async (configId) => {
        try {
          const agent = await readContract<{
            name: string
            lane: number
            capabilities: readonly `0x${string}`[]
            costWei: bigint
            eloScore: bigint
            isActive: boolean
            tasksCompleted: bigint
            tasksFailed: bigint
            avgLatencyMs: bigint
            trustTier: number
            somniaAgentId: bigint
            registrant: Address
            endpointHash: Hex
            depositWei: bigint
            suspended: boolean
          }>(publicClient, {
            address: CONTRACTS.agentRegistry.address,
            abi: AgentRegistryAbi,
            functionName: 'get',
            args: [BigInt(configId)],
          })

          if (!agent.name) return

          const caps = agent.capabilities.map((c) => {
            return CAPABILITY_NAME_MAP[c.toLowerCase()] || `${c.slice(0, 8)}…`
          })

          list.push({
            configId,
            name: agent.name,
            lane: agent.lane === 0 ? 'SomniaNative' : 'ExternalHTTP',
            cost: formatEther(agent.costWei),
            eloScore: Number(agent.eloScore),
            isActive: agent.isActive,
            suspended: agent.suspended,
            tasksCompleted: Number(agent.tasksCompleted),
            tasksFailed: Number(agent.tasksFailed),
            avgLatencyMs: Number(agent.avgLatencyMs),
            trustTier: Number(agent.trustTier),
            capabilities: caps,
            somniaAgentId:
              agent.somniaAgentId > 0n ? agent.somniaAgentId.toString() : undefined,
            registrant: agent.registrant,
            endpointHash: agent.endpointHash,
            depositWei: formatEther(agent.depositWei),
          })
        } catch (e) {
          console.error(`Error fetching sub-agent configId ${configId}:`, e)
        }
      })

      await Promise.all(promises)
      
      // Sort by Elo score descending (best performance first)
      setSubAgents(list.sort((a, b) => b.eloScore - a.eloScore))
    } catch (e: unknown) {
      console.error('Error loading sub-agents:', e)
      const message = e instanceof Error ? e.message : 'Failed to load sub-agents'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [publicClient])

  useEffect(() => {
    loadSubAgents()
  }, [loadSubAgents])

  return {
    subAgents,
    isLoading,
    error,
    refetchSubAgents: loadSubAgents,
  }
}
