import { useCallback } from 'react'
import { useWriteContract, usePublicClient } from 'wagmi'
import { parseEventLogs, type Address } from 'viem'
import { AgentOrchestratorAbi, TwiinAccountAbi } from '@/config/contracts'
import { somniaTestnet } from '@/config/chains'

export function useCreateTask() {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()

  const submitCreateTask = useCallback(
    async (input: {
      tbaAddress: Address
      orchestrator: Address
      budgetWei: bigint
      createTaskCalldata: `0x${string}`
    }): Promise<{ txHash: `0x${string}`; taskId: string | null }> => {
      const txHash = await writeContractAsync({
        chainId: somniaTestnet.id,
        address: input.tbaAddress,
        abi: TwiinAccountAbi,
        functionName: 'execute',
        args: [input.orchestrator, input.budgetWei, input.createTaskCalldata, 0],
      } as never)

      if (!publicClient) return { txHash, taskId: null }

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
      const logs = parseEventLogs({
        abi: AgentOrchestratorAbi,
        logs: receipt.logs,
        eventName: 'TaskCreated',
      })
      const taskId = logs[0]?.args.taskId?.toString() ?? null
      return { txHash, taskId }
    },
    [writeContractAsync, publicClient],
  )

  return { submitCreateTask }
}
