import { zeroHash, type Hex } from 'viem'
import { NativeConfigId } from '@/config/contracts'
import type { SubAgentInfo } from '@/hooks/useSubAgents'

export type SubAgentStatus = 'live' | 'suspended' | 'inactive' | 'reserved' | 'unregistered'

export function getSubAgentStatus(agent: SubAgentInfo): SubAgentStatus {
  if (agent.configId === NativeConfigId.JANICE || agent.configId === NativeConfigId.EXECUTOR) {
    return 'reserved'
  }
  if (!agent.name) return 'unregistered'
  if (agent.suspended) return 'suspended'
  if (!agent.isActive) return 'inactive'
  if (agent.lane === 'ExternalHTTP') {
    const hash = agent.endpointHash
    if (!hash || hash === zeroHash) return 'inactive'
  }
  return 'live'
}

export function statusBadgeVariant(
  status: SubAgentStatus,
): 'success' | 'danger' | 'warning' | 'default' {
  switch (status) {
    case 'live':
      return 'success'
    case 'suspended':
      return 'danger'
    case 'inactive':
    case 'unregistered':
      return 'warning'
    default:
      return 'default'
  }
}

export function statusLabel(status: SubAgentStatus): string {
  switch (status) {
    case 'live':
      return 'Live'
    case 'suspended':
      return 'Suspended'
    case 'inactive':
      return 'Inactive'
    case 'unregistered':
      return 'Empty'
    case 'reserved':
      return 'System'
  }
}

export function winRate(agent: SubAgentInfo): number {
  const total = agent.tasksCompleted + agent.tasksFailed
  if (total === 0) return 0
  return Math.round((agent.tasksCompleted / total) * 100)
}

export function truncateAddress(addr: string | undefined): string {
  if (!addr || addr.length < 10) return '—'
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function hasEndpoint(agent: SubAgentInfo): boolean {
  const hash = agent.endpointHash as Hex | undefined
  return !!hash && hash !== zeroHash
}
