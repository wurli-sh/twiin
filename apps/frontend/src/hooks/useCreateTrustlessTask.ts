import { useCallback } from 'react'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import { parseEventLogs, type Address } from 'viem'
import { AgentOrchestratorAbi, TwiinAccountAbi } from '@/config/contracts'
import { somniaTestnet } from '@/config/chains'
import type { TwiinAgentInfo } from '@/hooks/useTwiinAgents'

export function useCreateTrustlessTask() {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()

  const submitCreateTrustlessTask = useCallback(
    async (input: {
      agent: TwiinAgentInfo
      orchestrator: Address
      budgetWei: bigint
      createTaskCalldata: `0x${string}`
    }): Promise<{ txHash: `0x${string}`; taskId: string | null }> => {
      if (!address) throw new Error('Wallet not connected')
      if (!publicClient) throw new Error('RPC not ready')

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
      return {
        txHash,
        taskId: logs[0]?.args.taskId?.toString() ?? null,
      }
    },
    [address, publicClient, writeContractAsync],
  )

  return { submitCreateTrustlessTask }
}
