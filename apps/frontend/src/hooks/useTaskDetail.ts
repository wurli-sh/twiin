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
  consensusValidators: number | null
  consensusReceiptId: string | null
  consensusMedianCostWei: string | null
}

export type TaskCompletion = {
  result: string
  decoded: string | null
  blockNumber: string
  transactionHash: string
}

type StepsResponse = {
  steps: {
    step_idx: number
    config_id: string
    state: number
    payload: string
    result_hex: string | null
    score: number | null
    consensus_validators: number | null
    consensus_receipt_id: string | null
    consensus_median_cost_wei: string | null
  }[]
}

export function useTaskDetail(taskId: string | null, version: number) {
  const publicClient = usePublicClient()
  const [task, setTask] = useState<ChainTask | null>(null)
  const [steps, setSteps] = useState<TaskStep[]>([])
  const [completion, setCompletion] = useState<TaskCompletion | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const terminalGraceUntil = useRef(0)

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
          const mapped = await Promise.all(
            body.steps.map(async (s) => {
              const base: TaskStep = {
                stepIdx: s.step_idx,
                configId: s.config_id,
                state: s.state,
                payload: s.payload,
                resultHex: s.result_hex,
                score: s.score,
                consensusValidators: s.consensus_validators,
                consensusReceiptId: s.consensus_receipt_id,
                consensusMedianCostWei: s.consensus_median_cost_wei,
              }
              if (base.consensusValidators && base.consensusValidators > 0) return base
              try {
                const receipt = await readContract<
                  readonly [bigint, bigint, bigint, bigint]
                >(publicClient, {
                  address: CONTRACTS.orchestrator.address,
                  abi: AgentOrchestratorAbi,
                  functionName: 'stepConsensusOf',
                  args: [BigInt(taskId), s.step_idx],
                })
                const validators = Number(receipt[0])
                if (!validators) return base
                return {
                  ...base,
                  consensusValidators: validators,
                  consensusReceiptId: receipt[2].toString(),
                  consensusMedianCostWei: receipt[3].toString(),
                }
              } catch {
                return base
              }
            }),
          )
          setSteps(mapped)
        }
      } catch {
        // steps are advisory; chain task state is the source of truth
      }

      if (chainTask.state === TaskState.Completed) {
        try {
          const res = await fetch(`/api/tasks/${taskId}/completion`)
          if (res.ok) {
            setCompletion((await res.json()) as TaskCompletion)
          } else {
            setCompletion(null)
          }
        } catch {
          setCompletion(null)
        }
      } else {
        setCompletion(null)
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
      setCompletion(null)
      terminalGraceUntil.current = 0
      return
    }

    terminalGraceUntil.current = 0
    let cancelled = false
    const tick = async () => {
      const state = await load()
      if (cancelled) return
      const terminal = state === TaskState.Completed || state === TaskState.Aborted
      if (terminal) {
        if (!terminalGraceUntil.current) {
          terminalGraceUntil.current = Date.now() + 45_000
        }
        if (Date.now() >= terminalGraceUntil.current && timer.current) {
          clearInterval(timer.current)
          timer.current = null
        }
      } else {
        terminalGraceUntil.current = 0
      }
    }

    void tick()
    timer.current = setInterval(() => void tick(), 2000)

    return () => {
      cancelled = true
      terminalGraceUntil.current = 0
      if (timer.current) {
        clearInterval(timer.current)
        timer.current = null
      }
    }
  }, [taskId, load, version])

  return { task, steps, completion, isLoading, refetch: load }
}
