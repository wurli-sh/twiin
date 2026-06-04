import rawAddresses from '@twiin/shared/addresses.json'
import { loadAddresses } from '@twiin/shared'
export * from '@twiin/shared'

export const addresses = loadAddresses(rawAddresses)

export const CONTRACTS = {
  factory: {
    address: addresses.factory,
  },
  twiinAgent: {
    address: addresses.twiinAgent,
  },
  twiinNames: {
    address: addresses.twiinNames,
  },
  registry6551: {
    address: addresses.registry6551,
  },
  twiinAccountImpl: {
    address: addresses.twiinAccountImpl,
  },
  agentRegistry: {
    address: addresses.agentRegistry,
  },
  policy: {
    address: addresses.policy,
  },
  orchestrator: {
    address: addresses.orchestrator,
  },
  vault: {
    address: addresses.vault,
  },
  oracleFeed: {
    address: addresses.oracleFeed,
  },
} as const
