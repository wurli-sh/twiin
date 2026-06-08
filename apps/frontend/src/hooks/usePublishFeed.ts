import { useCallback, useState } from 'react'
import { useWriteContract, usePublicClient } from 'wagmi'
import { zeroHash } from 'viem'
import { AgentRefreshCoordinatorAbi, CONTRACTS } from '@/config/contracts'
import { somniaTestnet } from '@/config/chains'
import type { PublishFeedParams } from '@/lib/publish-feed-params'

export function usePublishFeed() {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const [isPublishing, setIsPublishing] = useState(false)

  const publishFeed = useCallback(
    async (
      personalAgentId: bigint,
      params: PublishFeedParams,
    ): Promise<`0x${string}`> => {
      if (!publicClient) throw new Error('RPC not ready')

      setIsPublishing(true)
      try {
        const txHash = await writeContractAsync({
          chainId: somniaTestnet.id,
          address: CONTRACTS.refreshManager.address,
          abi: AgentRefreshCoordinatorAbi,
          functionName: 'publishFeedForOwner',
          args: [
            personalAgentId,
            params.topic,
            params.value,
            params.confidence,
            3600n,
            0n,
            zeroHash,
          ],
        } as never)

        await publicClient.waitForTransactionReceipt({ hash: txHash })
        return txHash
      } finally {
        setIsPublishing(false)
      }
    },
    [writeContractAsync, publicClient],
  )

  return { publishFeed, isPublishing }
}
