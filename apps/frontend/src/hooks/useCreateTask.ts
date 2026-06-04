import { useCallback } from 'react'
import { useWriteContract, usePublicClient, useAccount } from 'wagmi'
import { parseEventLogs, type Address } from 'viem'
import { AgentOrchestratorAbi, TwiinAccountAbi } from '@/config/contracts'
import { somniaTestnet } from '@/config/chains'
import { preflightCreateTask, explainRevertReason } from '@/lib/preflight-create-task'
import type { TwiinAgentInfo } from '@/hooks/useTwiinAgents'

export function useCreateTask() {
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()

  const submitCreateTask = useCallback(
    async (input: {
      agent: TwiinAgentInfo
      orchestrator: Address
      budgetWei: bigint
      createTaskCalldata: `0x${string}`
    }): Promise<{ txHash: `0x${string}`; taskId: string | null }> => {
      if (!address) throw new Error('Wallet not connected')
      if (!publicClient) throw new Error('RPC not ready')

      const preflight = await preflightCreateTask(publicClient, {
        owner: address,
        personalAgentId: input.agent.id,
        tbaAddress: input.agent.tbaAddress,
        orchestrator: input.orchestrator,
        budgetWei: input.budgetWei,
        createTaskCalldata: input.createTaskCalldata,
        killSwitch: input.agent.killSwitch,
        maxPerTaskStt: input.agent.maxPerTask,
        dailyCapStt: input.agent.dailyCap,
        dailySpentStt: input.agent.dailySpent,
      })

      if (!preflight.ok) {
        throw new Error(preflight.errors.join(' '))
      }

      try {
        const txHash = await writeContractAsync({
          chainId: somniaTestnet.id,
          address: input.agent.tbaAddress,
          abi: TwiinAccountAbi,
          functionName: 'execute',
          args: [input.orchestrator, input.budgetWei, input.createTaskCalldata, 0],
        } as never)

        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
        const logs = parseEventLogs({
          abi: AgentOrchestratorAbi,
          logs: receipt.logs,
          eventName: 'TaskCreated',
        })
        const taskId = logs[0]?.args.taskId?.toString() ?? null
        return { txHash, taskId }
      } catch (e: unknown) {
        const raw = e instanceof Error ? e.message : String(e)
        throw new Error(explainRevertReason(raw))
      }
    },
    [writeContractAsync, publicClient, address],
  )

  return { submitCreateTask }
}
