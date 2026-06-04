import type { TwiinAgentInfo } from '@/hooks/useTwiinAgents'

export function dailyRemainingStt(agent: TwiinAgentInfo): number {
  return Math.max(0, Number(agent.dailyCap) - Number(agent.dailySpent))
}

/** Max STT the agent can spend on one task right now (policy + wallet + daily). */
export function maxTaskBudgetStt(agent: TwiinAgentInfo): number {
  const parts = [
    Number(agent.maxPerTask),
    Number(agent.tbaBalance),
    dailyRemainingStt(agent),
  ].filter((n) => n > 0)
  return parts.length ? Math.min(...parts) : 0
}

export function suggestedTaskBudgetStt(agent: TwiinAgentInfo, estimatedStt: number): number {
  const needed = Math.ceil(estimatedStt * 100) / 100
  return Math.min(needed, maxTaskBudgetStt(agent))
}

export function policyAllowsBudget(agent: TwiinAgentInfo, budgetStt: number): boolean {
  if (budgetStt > Number(agent.maxPerTask)) return false
  if (budgetStt > dailyRemainingStt(agent)) return false
  return budgetStt <= Number(agent.tbaBalance)
}
