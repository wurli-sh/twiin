export type PlanStep = {
  configId: number
  payload: string
  maxCostWei: string
  timeoutSeconds: number
}

export type PlanResponse = {
  planId?: string
  steps: PlanStep[]
  createTaskCalldata: `0x${string}`
  orchestrator: `0x${string}`
  estimatedCostWei: string
  budgetWei: string
  verificationTier?: 'corroborated' | 'single'
  source?: 'llm' | 'template' | 'substituted'
}

export type PlanErrorCode =
  | 'BUDGET_EXCEEDED'
  | 'NO_CAPABLE_AGENT'
  | 'PLANNER_UNAVAILABLE'
  | 'INVALID_REQUEST'
  | 'RATE_LIMITED'

export type PlanErrorBody = {
  error: string
  code?: PlanErrorCode
  estimatedCostWei?: string
  budgetWei?: string
  requiredStepCount?: number
  missingCapabilities?: string[]
  suggestedBudgetWei?: string
  retryAfterSeconds?: number
  agentName?: string
  unhealthyConfigId?: number
}

export class PlanOverBudgetError extends Error {
  estimatedStt: number
  budgetStt: number
  code: PlanErrorCode = 'BUDGET_EXCEEDED'

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

export class PlanUnavailableError extends Error {
  code: PlanErrorCode
  retryAfterSeconds?: number

  constructor(body: PlanErrorBody) {
    super(body.error)
    this.name = 'PlanUnavailableError'
    this.code = body.code ?? 'PLANNER_UNAVAILABLE'
    this.retryAfterSeconds = body.retryAfterSeconds
  }
}

export class PlanNoAgentError extends Error {
  code: PlanErrorCode = 'NO_CAPABLE_AGENT'
  missingCapabilities?: string[]
  agentName?: string
  unhealthyConfigId?: number

  constructor(body: PlanErrorBody) {
    super(body.error)
    this.name = 'PlanNoAgentError'
    this.missingCapabilities = body.missingCapabilities
    this.agentName = body.agentName
    this.unhealthyConfigId = body.unhealthyConfigId
  }
}

export function isPlanOverBudgetError(e: unknown): e is PlanOverBudgetError {
  return e instanceof PlanOverBudgetError
}

export function isPlanUnavailableError(e: unknown): e is PlanUnavailableError {
  return e instanceof PlanUnavailableError
}

export function isPlanNoAgentError(e: unknown): e is PlanNoAgentError {
  return e instanceof PlanNoAgentError
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function requestPlan(input: {
  goal: string
  personalAgentId: string
  budgetWei: string
  signal?: AbortSignal
  maxRetries?: number
}): Promise<PlanResponse> {
  const secret = import.meta.env.VITE_PLAN_SECRET as string | undefined
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (secret) headers['x-plan-secret'] = secret

  const { signal, maxRetries = 2, ...payload } = input
  let attempt = 0;
  let lastError: unknown

  while (attempt <= maxRetries) {
    try {
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal,
      })

      const responseBody = (await res.json()) as PlanResponse | PlanErrorBody
      if (!res.ok) {
        const err = responseBody as PlanErrorBody
        if (
          (res.status === 422 && err.code === 'BUDGET_EXCEEDED') ||
          (res.status === 422 &&
            err.estimatedCostWei &&
            err.budgetWei &&
            err.error === 'planned step costs exceed task budget')
        ) {
          throw new PlanOverBudgetError(
            err.estimatedCostWei ?? err.suggestedBudgetWei ?? '0',
            err.budgetWei ?? payload.budgetWei,
          )
        }
        if (res.status === 422 && err.code === 'NO_CAPABLE_AGENT') {
          throw new PlanNoAgentError(err)
        }
        if (res.status === 503 || err.code === 'PLANNER_UNAVAILABLE') {
          if (attempt < maxRetries) {
            attempt++
            await sleep(3_000)
            continue
          }
          throw new PlanUnavailableError(err)
        }
        if (res.status === 429) {
          throw new PlanUnavailableError({
            ...err,
            code: 'RATE_LIMITED',
          })
        }
        throw new Error(err.error ?? `Plan failed (${res.status})`)
      }
      return responseBody as PlanResponse
    } catch (error) {
      lastError = error
      if (
        error instanceof PlanOverBudgetError ||
        error instanceof PlanNoAgentError ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        throw error
      }
      if (attempt < maxRetries) {
        attempt++
        await sleep(3_000)
        continue
      }
      throw error
    }
  }

  throw lastError ?? new Error('Plan failed')
}
