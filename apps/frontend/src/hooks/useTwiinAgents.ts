import { useState, useEffect, useCallback } from 'react'
import {
  useAccount,
  useReadContract,
  useWriteContract,
  usePublicClient,
} from 'wagmi'
import { parseEther, formatEther, type Address } from 'viem'
import {
  CONTRACTS,
  TwiinFactoryAbi,
  TwiinAgentAbi,
  TwiinNamesAbi,
  AgentPolicyAbi,
  deriveTwiinAccountAddress,
} from '@/config/contracts'
import { readContract } from '@/lib/read-contract'
import { somniaTestnet } from '@/config/chains'

export interface TwiinAgentInfo {
  id: bigint
  name: string
  tbaAddress: Address
  tbaBalance: string
  killSwitch: boolean
  dailyCap: string
  maxPerTask: string
  dailySpent: string
}

export function useTwiinAgents() {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const [agents, setAgents] = useState<TwiinAgentInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { writeContractAsync } = useWriteContract()

  const { data: nextTokenId, refetch: refetchNextToken } = useReadContract({
    address: CONTRACTS.twiinAgent.address,
    abi: TwiinAgentAbi,
    functionName: 'nextTokenId',
  })

  const loadAgents = useCallback(async () => {
    if (!address || !nextTokenId || !publicClient) {
      setAgents([])
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const activeAgents: TwiinAgentInfo[] = []
      const total = Number(nextTokenId)

      const promises = Array.from({ length: total }, (_, i) => BigInt(i + 1)).map(
        async (id) => {
          try {
            const owner = await readContract<Address>(publicClient, {
              address: CONTRACTS.twiinAgent.address,
              abi: TwiinAgentAbi,
              functionName: 'ownerOf',
              args: [id],
            })

            if (owner.toLowerCase() !== address.toLowerCase()) return

            const name = await readContract<string>(publicClient, {
              address: CONTRACTS.twiinNames.address,
              abi: TwiinNamesAbi,
              functionName: 'agentName',
              args: [1, id],
            })

            const tbaAddress = deriveTwiinAccountAddress({
              registry6551: CONTRACTS.registry6551.address,
              twiinAccountImpl: CONTRACTS.twiinAccountImpl.address,
              twiinAgent: CONTRACTS.twiinAgent.address,
              tokenId: id,
            })

            const balance = await publicClient.getBalance({ address: tbaAddress })
            const balanceFormatted = Number(formatEther(balance)).toFixed(4)

            const policy = await readContract<
              readonly [bigint, bigint, bigint, boolean, bigint, bigint]
            >(publicClient, {
              address: CONTRACTS.policy.address,
              abi: AgentPolicyAbi,
              functionName: 'policies',
              args: [id],
            })

            activeAgents.push({
              id,
              name: name || `Agent #${id}`,
              tbaAddress,
              tbaBalance: balanceFormatted,
              killSwitch: policy[3],
              dailyCap: formatEther(policy[0]),
              maxPerTask: formatEther(policy[1]),
              dailySpent: formatEther(policy[4]),
            })
          } catch (e) {
            console.error(`Error loading agent details for ID ${id}:`, e)
          }
        },
      )

      await Promise.all(promises)
      setAgents(activeAgents.sort((a, b) => Number(b.id - a.id)))
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to list agents'
      console.error('Error listing agents:', e)
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [address, nextTokenId, publicClient])

  useEffect(() => {
    void loadAgents()
  }, [loadAgents])

  const mintAgent = async (name: string, fundAmountSTT: string) => {
    if (!address) throw new Error('Wallet not connected')
    const value = fundAmountSTT ? parseEther(fundAmountSTT) : 0n

    const tx = await writeContractAsync({
      chainId: somniaTestnet.id,
      address: CONTRACTS.factory.address,
      abi: TwiinFactoryAbi,
      functionName: 'deployTwiin',
      args: [name],
      value,
    } as never)

    await refetchNextToken()
    return tx
  }

  const toggleKillSwitch = async (agentId: bigint, currentState: boolean) => {
    const tx = await writeContractAsync({
      chainId: somniaTestnet.id,
      address: CONTRACTS.policy.address,
      abi: AgentPolicyAbi,
      functionName: 'toggleKillSwitch',
      args: [agentId, !currentState],
    } as never)

    window.setTimeout(() => void loadAgents(), 2000)
    return tx
  }

  return {
    agents,
    isLoading,
    error,
    mintAgent,
    toggleKillSwitch,
    refetchAgents: loadAgents,
  }
}
