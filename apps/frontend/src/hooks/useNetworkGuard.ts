import { useAccount, useSwitchChain } from 'wagmi'
import { somniaTestnet } from '@/config/chains'

export function useNetworkGuard() {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending } = useSwitchChain()

  const wrongNetwork = isConnected && chainId !== undefined && chainId !== somniaTestnet.id

  const switchToSomnia = () => switchChain({ chainId: somniaTestnet.id })

  return {
    wrongNetwork,
    isSwitching: isPending,
    switchToSomnia,
    targetName: somniaTestnet.name,
  }
}
