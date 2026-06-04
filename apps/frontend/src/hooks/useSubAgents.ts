import { useState, useEffect, useCallback } from 'react'
import { formatEther, zeroAddress, zeroHash, type Address, type Hex } from 'viem'

export interface SubAgentInfo {
  configId: number
  name: string
  lane: 'SomniaNative' | 'ExternalHTTP'
  cost: string
  costWei: string
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
  endpointUrl?: string | null
  isVerified?: boolean
  lastVerifiedAt?: number | null
  lastError?: string | null
  updatedAt?: number | null
}

type AgentsApiResponse = {
  agents: Array<{
    configId: number
    name: string
    lane: 'SomniaNative' | 'ExternalHTTP'
    costWei: string
    eloScore: number
    isActive: boolean
    suspended: boolean
    tasksCompleted: number
    tasksFailed: number
    avgLatencyMs: number
    trustTier: number
    capabilities: string[]
    capabilityNames: string[]
    somniaAgentId: string | null
    registrant: Address
    endpointHash: Hex
    depositWei: string
    endpointUrl: string | null
    isVerified: boolean
    lastVerifiedAt: number | null
    lastError: string | null
    updatedAt: number | null
  }>
}

export function useSubAgents() {
  const [subAgents, setSubAgents] = useState<SubAgentInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadSubAgents = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/agents?active=true')
      if (!res.ok) {
        throw new Error(`Failed to load agents (${res.status})`)
      }

      const body = (await res.json()) as AgentsApiResponse
      const list = body.agents.map((agent) => ({
        configId: agent.configId,
        name: agent.name,
        lane: agent.lane,
        cost: formatEther(BigInt(agent.costWei)),
        costWei: agent.costWei,
        eloScore: agent.eloScore,
        isActive: agent.isActive,
        suspended: agent.suspended,
        tasksCompleted: agent.tasksCompleted,
        tasksFailed: agent.tasksFailed,
        avgLatencyMs: agent.avgLatencyMs,
        trustTier: agent.trustTier,
        capabilities: agent.capabilityNames,
        somniaAgentId: agent.somniaAgentId ?? undefined,
        registrant:
          agent.registrant && agent.registrant !== zeroAddress
            ? agent.registrant
            : undefined,
        endpointHash:
          agent.endpointHash && agent.endpointHash !== zeroHash
            ? agent.endpointHash
            : undefined,
        depositWei: formatEther(BigInt(agent.depositWei)),
        endpointUrl: agent.endpointUrl,
        isVerified: agent.isVerified,
        lastVerifiedAt: agent.lastVerifiedAt,
        lastError: agent.lastError,
        updatedAt: agent.updatedAt,
      }))

      setSubAgents(list.sort((a, b) => b.eloScore - a.eloScore))
    } catch (e: unknown) {
      console.error('Error loading sub-agents:', e)
      const message = e instanceof Error ? e.message : 'Failed to load sub-agents'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSubAgents()
  }, [loadSubAgents])

  return {
    subAgents,
    isLoading,
    error,
    refetchSubAgents: loadSubAgents,
  }
}
