export type TrustlessPreflightResponse = {
  orchestrator: `0x${string}`
  createTaskCalldata: `0x${string}`
  budgetWei: string
  minBudgetWei: string
  janiceCostWei: string
  maxIterations: number
  warnings: string[]
}

export type TrustlessPreflightError = {
  error: string
  budgetWei?: string
  minBudgetWei?: string
  janiceCostWei?: string
}

export class TrustlessBudgetTooLowError extends Error {
  minBudgetWei: string
  budgetWei: string

  constructor(minBudgetWei: string, budgetWei: string) {
    super('Trustless budget is below the minimum required Janice escrow')
    this.name = 'TrustlessBudgetTooLowError'
    this.minBudgetWei = minBudgetWei
    this.budgetWei = budgetWei
  }
}

export function isTrustlessBudgetTooLowError(
  value: unknown,
): value is TrustlessBudgetTooLowError {
  return value instanceof TrustlessBudgetTooLowError
}

export async function requestTrustlessPreflight(input: {
  goal: string
  personalAgentId: string
  budgetWei: string
}): Promise<TrustlessPreflightResponse> {
  const res = await fetch('/api/trustless-preflight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = (await res.json()) as TrustlessPreflightResponse | TrustlessPreflightError
  if (!res.ok) {
    const err = body as TrustlessPreflightError
    if (
      res.status === 422 &&
      err.error === 'trustless budget below minimum' &&
      err.minBudgetWei &&
      err.budgetWei
    ) {
      throw new TrustlessBudgetTooLowError(err.minBudgetWei, err.budgetWei)
    }
    throw new Error(err.error ?? `Trustless preflight failed (${res.status})`)
  }
  return body as TrustlessPreflightResponse
}
