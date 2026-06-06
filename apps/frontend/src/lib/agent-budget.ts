import type { TwiinAgentInfo } from '@/hooks/useTwiinAgents'
import type { ExecutionMode } from '@/config/features'

export function perTaskCapStt(agent: TwiinAgentInfo, mode: ExecutionMode = 'claude'): number {
  return Number(mode === 'trustless' ? agent.maxPerTaskTrustless : agent.maxPerTask)
}

export function dailyRemainingStt(agent: TwiinAgentInfo): number {
  return Math.max(0, Number(agent.dailyCap) - Number(agent.dailySpent))
}

/** Max STT the agent can spend on one task right now (policy + wallet + daily). */
export function maxTaskBudgetStt(
  agent: TwiinAgentInfo,
  mode: ExecutionMode = 'claude',
): number {
  const parts = [
    perTaskCapStt(agent, mode),
    Number(agent.tbaBalance),
    dailyRemainingStt(agent),
  ].filter((n) => n > 0)
  return parts.length ? Math.min(...parts) : 0
}

export function suggestedTaskBudgetStt(
  agent: TwiinAgentInfo,
  estimatedStt: number,
  mode: ExecutionMode = 'claude',
): number {
  const needed = Math.ceil(estimatedStt * 100) / 100
  return Math.min(needed, maxTaskBudgetStt(agent, mode))
}

export function policyAllowsBudget(
  agent: TwiinAgentInfo,
  budgetStt: number,
  mode: ExecutionMode = 'claude',
): boolean {
  if (budgetStt > perTaskCapStt(agent, mode)) return false
  if (budgetStt > dailyRemainingStt(agent)) return false
  return budgetStt <= Number(agent.tbaBalance)
}
