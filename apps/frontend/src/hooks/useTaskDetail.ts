import { useState, useEffect, useCallback, useRef } from 'react'
import { usePublicClient } from 'wagmi'
import { formatEther } from 'viem'
import { CONTRACTS, AgentOrchestratorAbi, TaskState } from '@/config/contracts'
import { readContract } from '@/lib/read-contract'

export type ChainTask = {
  mode: number
  personalAgentId: string
  cursor: number
  budget: string
  spent: string
  deadline: number
  state: number
}

export type TaskStep = {
  stepIdx: number
  configId: string
  state: number
  payload: string
  resultHex: string | null
  score: number | null
}

type StepsResponse = {
  steps: {
    step_idx: number
    config_id: string
    state: number
    payload: string
    result_hex: string | null
    score: number | null
  }[]
}

export function useTaskDetail(taskId: string | null, version: number) {
  const publicClient = usePublicClient()
  const [task, setTask] = useState<ChainTask | null>(null)
  const [steps, setSteps] = useState<TaskStep[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    if (!publicClient || !taskId) return
    setIsLoading(true)
    try {
      const raw = await readContract<
        readonly [number, bigint, number, bigint, bigint, bigint, number]
      >(publicClient, {
        address: CONTRACTS.orchestrator.address,
        abi: AgentOrchestratorAbi,
        functionName: 'tasks',
        args: [BigInt(taskId)],
      })
      const chainTask: ChainTask = {
        mode: raw[0],
        personalAgentId: raw[1].toString(),
        cursor: raw[2],
        budget: formatEther(raw[3]),
        spent: formatEther(raw[4]),
        deadline: Number(raw[5]),
        state: raw[6],
      }
      setTask(chainTask)

      try {
        const res = await fetch(`/api/tasks/${taskId}/steps`)
        if (res.ok) {
          const body = (await res.json()) as StepsResponse
          setSteps(
            body.steps.map((s) => ({
              stepIdx: s.step_idx,
              configId: s.config_id,
              state: s.state,
              payload: s.payload,
              resultHex: s.result_hex,
              score: s.score,
            })),
          )
        }
      } catch {
        // steps are advisory; chain task state is the source of truth
      }

      return chainTask.state
    } finally {
      setIsLoading(false)
    }
  }, [publicClient, taskId])

  useEffect(() => {
    if (!taskId) {
      setTask(null)
      setSteps([])
      return
    }

    let cancelled = false
    const tick = async () => {
      const state = await load()
      if (cancelled) return
      const terminal = state === TaskState.Completed || state === TaskState.Aborted
      if (terminal && timer.current) {
        clearInterval(timer.current)
        timer.current = null
      }
    }

    void tick()
    timer.current = setInterval(() => void tick(), 5000)

    return () => {
      cancelled = true
      if (timer.current) {
        clearInterval(timer.current)
        timer.current = null
      }
    }
  }, [taskId, load, version])

  return { task, steps, isLoading, refetch: load }
}
