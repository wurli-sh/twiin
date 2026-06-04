import { http, createConfig } from 'wagmi'
import { metaMask, coinbaseWallet, walletConnect } from 'wagmi/connectors'
import { somniaTestnet } from './chains'

const projectId = import.meta.env.VITE_WC_PROJECT_ID || ''

export const config = createConfig({
  chains: [somniaTestnet],
  connectors: [
    metaMask(),
    coinbaseWallet({ appName: 'Twiin' }),
    ...(projectId ? [walletConnect({ projectId })] : []),
  ],
  batch: {
    // Multicall3 is not deployed on Somnia testnet — disable batching
    multicall: false,
  },
  transports: {
    [somniaTestnet.id]: http(),
  },
})
