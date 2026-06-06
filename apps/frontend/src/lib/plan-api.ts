export type PlanStep = {
  configId: number
  payload: string
  maxCostWei: string
  timeoutSeconds: number
}

export type PlanResponse = {
  steps: PlanStep[]
  createTaskCalldata: `0x${string}`
  orchestrator: `0x${string}`
  estimatedCostWei: string
  budgetWei: string
}

export type PlanError = {
  error: string
  estimatedCostWei?: string
  budgetWei?: string
}

export class PlanOverBudgetError extends Error {
  estimatedStt: number
  budgetStt: number

  constructor(estimatedCostWei: string, budgetWei: string) {
    const estimatedStt = Number(estimatedCostWei) / 1e18
    const budgetStt = Number(budgetWei) / 1e18
    super(
      `Plan needs about ${estimatedStt.toFixed(2)} STT but budget is ${budgetStt.toFixed(2)} STT`,
    )
    this.name = 'PlanOverBudgetError'
    this.estimatedStt = estimatedStt
    this.budgetStt = budgetStt
  }
}

export function isPlanOverBudgetError(e: unknown): e is PlanOverBudgetError {
  return e instanceof PlanOverBudgetError
}

export async function requestPlan(input: {
  goal: string
  personalAgentId: string
  budgetWei: string
  signal?: AbortSignal
}): Promise<PlanResponse> {
  const secret = import.meta.env.VITE_PLAN_SECRET as string | undefined
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (secret) headers['x-plan-secret'] = secret

  const { signal, ...payload } = input
  const res = await fetch('/api/plan', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal,
  })

  const responseBody = (await res.json()) as PlanResponse | PlanError
  if (!res.ok) {
    const err = responseBody as PlanError
    if (
      res.status === 422 &&
      err.estimatedCostWei &&
      err.budgetWei &&
      err.error === 'planned step costs exceed task budget'
    ) {
      throw new PlanOverBudgetError(err.estimatedCostWei, err.budgetWei)
    }
    throw new Error(err.error ?? `Plan failed (${res.status})`)
  }
  return responseBody as PlanResponse
}
