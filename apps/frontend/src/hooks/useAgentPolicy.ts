import { useCallback, useState } from 'react'
import { useWriteContract, usePublicClient } from 'wagmi'
import { parseEther, type Address } from 'viem'
import {
  CONTRACTS,
  AgentPolicyAbi,
  TwiinAccountAbi,
} from '@/config/contracts'
import { readContract } from '@/lib/read-contract'
import { somniaTestnet } from '@/config/chains'

export type PullApproval = {
  perTickWei: bigint
  periodSeconds: bigint
  lastPullAt: bigint
  active: boolean
}

export function useAgentPolicy() {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const [isSaving, setIsSaving] = useState(false)

  const loadPullApproval = useCallback(
    async (tbaAddress: Address): Promise<PullApproval | null> => {
      if (!publicClient) return null
      try {
        const raw = await readContract<
          readonly [bigint, bigint, bigint]
        >(publicClient, {
          address: tbaAddress,
          abi: TwiinAccountAbi,
          functionName: 'pullApprovals',
          args: [CONTRACTS.refreshManager.address],
        })
        const perTickWei = raw[0]
        const periodSeconds = raw[1]
        return {
          perTickWei,
          periodSeconds,
          lastPullAt: raw[2],
          active: perTickWei > 0n && periodSeconds > 0n,
        }
      } catch {
        return null
      }
    },
    [publicClient],
  )

  const updatePolicy = useCallback(
    async (input: {
      agentId: bigint
      dailyCapStt: string
      maxPerTaskStt: string
      killSwitch: boolean
    }) => {
      if (!publicClient) throw new Error('RPC not ready')
      setIsSaving(true)
      try {
        let allowedContracts: Address[] = [CONTRACTS.mockRouter.address]
        try {
          const onChain = await readContract<readonly Address[]>(publicClient, {
            address: CONTRACTS.policy.address,
            abi: [
              {
                type: 'function',
                name: 'getAllowedContracts',
                stateMutability: 'view',
                inputs: [{ name: 'personalAgentId', type: 'uint256' }],
                outputs: [{ name: '', type: 'address[]' }],
              },
            ],
            functionName: 'getAllowedContracts',
            args: [input.agentId],
          })
          if (onChain.length > 0) allowedContracts = [...onChain]
        } catch {
          // Deployed policy may predate getAllowedContracts — keep factory seed allowlist.
        }

        const tx = await writeContractAsync({
          chainId: somniaTestnet.id,
          address: CONTRACTS.policy.address,
          abi: AgentPolicyAbi,
          functionName: 'setPolicy',
          args: [
            input.agentId,
            parseEther(input.dailyCapStt),
            parseEther(input.maxPerTaskStt),
            allowedContracts,
            input.killSwitch,
          ],
        } as never)
        return tx
      } finally {
        setIsSaving(false)
      }
    },
    [publicClient, writeContractAsync],
  )

  const subscribePull = useCallback(
    async (input: {
      tbaAddress: Address
      perTickStt: string
      periodSeconds: number
    }) => {
      const perTickWei = parseEther(input.perTickStt)
      if (perTickWei > 2n ** 128n - 1n) {
        throw new Error('Per-tick amount exceeds uint128 max')
      }
      setIsSaving(true)
      try {
        const tx = await writeContractAsync({
          chainId: somniaTestnet.id,
          address: input.tbaAddress,
          abi: TwiinAccountAbi,
          functionName: 'subscribePull',
          args: [
            CONTRACTS.refreshManager.address,
            perTickWei,
            BigInt(input.periodSeconds),
          ],
        } as never)
        return tx
      } finally {
        setIsSaving(false)
      }
    },
    [writeContractAsync],
  )

  const revokePull = useCallback(
    async (tbaAddress: Address) => {
      setIsSaving(true)
      try {
        const tx = await writeContractAsync({
          chainId: somniaTestnet.id,
          address: tbaAddress,
          abi: TwiinAccountAbi,
          functionName: 'revokePull',
          args: [CONTRACTS.refreshManager.address],
        } as never)
        return tx
      } finally {
        setIsSaving(false)
      }
    },
    [writeContractAsync],
  )

  return {
    isSaving,
    loadPullApproval,
    updatePolicy,
    subscribePull,
    revokePull,
  }
}
