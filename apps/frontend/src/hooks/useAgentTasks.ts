import { useState, useEffect, useCallback, useMemo } from 'react'
import { usePublicClient } from 'wagmi'
import { formatEther } from 'viem'
import { CONTRACTS, AgentOrchestratorAbi } from '@/config/contracts'
import { readContract } from '@/lib/read-contract'

export type TaskInfo = {
  taskId: string
  personalAgentId: string
  mode: number
  cursor: number
  budget: string
  spent: string
  deadline: number
  state: number
}

const MAX_SCAN = 200

export function useAgentTasks(agentIds: bigint[]) {
  const publicClient = usePublicClient()
  const [tasks, setTasks] = useState<TaskInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const idKey = useMemo(
    () => agentIds.map((id) => id.toString()).sort().join(','),
    [agentIds],
  )

  const loadTasks = useCallback(async () => {
    if (!publicClient || agentIds.length === 0) {
      setTasks([])
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const idSet = new Set(agentIds.map((id) => id.toString()))
      const nextTaskId = await readContract<bigint>(publicClient, {
        address: CONTRACTS.orchestrator.address,
        abi: AgentOrchestratorAbi,
        functionName: 'nextTaskId',
      })

      const total = Number(nextTaskId)
      const first = Math.max(1, total - MAX_SCAN)
      const ids = Array.from({ length: total - first }, (_, i) => BigInt(first + i))

      const results = await Promise.all(
        ids.map(async (taskId) => {
          try {
            const raw = await readContract<
              readonly [number, bigint, number, bigint, bigint, bigint, number]
            >(publicClient, {
              address: CONTRACTS.orchestrator.address,
              abi: AgentOrchestratorAbi,
              functionName: 'tasks',
              args: [taskId],
            })
            const personalAgentId = raw[1].toString()
            if (!idSet.has(personalAgentId)) return null
            return {
              taskId: taskId.toString(),
              personalAgentId,
              mode: raw[0],
              cursor: raw[2],
              budget: formatEther(raw[3]),
              spent: formatEther(raw[4]),
              deadline: Number(raw[5]),
              state: raw[6],
            } satisfies TaskInfo
          } catch {
            return null
          }
        }),
      )

      setTasks(
        results
          .filter((t): t is TaskInfo => t !== null)
          .sort((a, b) => Number(b.taskId) - Number(a.taskId)),
      )
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load tasks')
      setTasks([])
    } finally {
      setIsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient, idKey])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  return { tasks, isLoading, error, refetchTasks: loadTasks }
}
