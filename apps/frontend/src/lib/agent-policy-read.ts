import { formatEther } from 'viem'

/** Deployed Somnia AgentPolicy.policies() return tuple (includes maxPerTaskWeiTrustless). */
export type PoliciesTuple = readonly [
  bigint,
  bigint,
  bigint,
  boolean,
  bigint,
  bigint,
]

export type ParsedAgentPolicy = {
  dailyCapWei: bigint
  maxPerTaskWei: bigint
  maxPerTaskWeiTrustless: bigint
  killSwitch: boolean
  dailySpent: bigint
  lastResetDay: bigint
}

export function parsePoliciesTuple(raw: PoliciesTuple): ParsedAgentPolicy {
  return {
    dailyCapWei: raw[0],
    maxPerTaskWei: raw[1],
    maxPerTaskWeiTrustless: raw[2],
    killSwitch: raw[3],
    dailySpent: raw[4],
    lastResetDay: raw[5],
  }
}

export function formatPolicyStt(wei: bigint): string {
  return Number(formatEther(wei)).toFixed(4)
}
