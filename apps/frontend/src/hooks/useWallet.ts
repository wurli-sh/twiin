import { useAccount, useConnect, useDisconnect, useBalance } from 'wagmi'
import { somniaTestnet } from '@/config/chains'
import type { Connector } from 'wagmi'

export function useWallet() {
  const { address, isConnected, isConnecting } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()
  const { data: balance, refetch: refetchBalance } = useBalance({ address })

  const connectWith = (connector: Connector) => {
    connect({ connector, chainId: somniaTestnet.id })
  }

  return {
    address,
    isConnected,
    isConnecting,
    balance: balance ? Number(balance.formatted).toFixed(2) : '0',
    symbol: balance?.symbol ?? 'STT',
    connectors,
    connectWith,
    disconnect,
    refetchBalance,
  }
}
