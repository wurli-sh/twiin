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

export async function requestPlan(input: {
  goal: string
  personalAgentId: string
  budgetWei: string
}): Promise<PlanResponse> {
  const secret = import.meta.env.VITE_PLAN_SECRET as string | undefined
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (secret) headers['x-plan-secret'] = secret

  const res = await fetch('/api/plan', {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  })

  const body = (await res.json()) as PlanResponse | PlanError
  if (!res.ok) {
    const err = body as PlanError
    throw new Error(err.error ?? `Plan failed (${res.status})`)
  }
  return body as PlanResponse
}
