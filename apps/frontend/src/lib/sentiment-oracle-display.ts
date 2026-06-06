import { NativeConfigId } from '@/config/contracts'

/** Matches buildSomniaSentimentTemplate() in the backend planner. */
export const SENTIMENT_ORACLE_STEP_COUNT = 4

const SENTIMENT_FIELD_LABELS = [
  'PRICE_USD (8 decimals)',
  'CHANGE_24H_PERCENT',
  'MARKET_CAP_USD (8 decimals)',
  'VOLUME_24H_USD (8 decimals)',
] as const

export function isSentimentOracleTask(
  steps: { configId: number | string }[],
): boolean {
  return (
    steps.length === SENTIMENT_ORACLE_STEP_COUNT &&
    steps.every((s) => Number(s.configId) === NativeConfigId.ORACLE)
  )
}

/** Decode a Somnia oracle uint256 scaled with 8 decimals (CoinGecko planner default). */
export function formatScaledUsd(raw: string, decimals = 8): string | null {
  if (!/^\d+$/.test(raw.trim())) return null
  const n = Number(raw) / 10 ** decimals
  if (!Number.isFinite(n)) return null
  if (Math.abs(n) >= 1) {
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }
  return n.toPrecision(4)
}

/**
 * TaskCompleted only carries the last step's native result. For the sentiment
 * template that is step 4 (24h volume).
 */
export function describeSentimentCompletion(raw: string | null | undefined): {
  field: string
  formatted: string
  hint: string
} | null {
  if (!raw?.trim() || !/^\d+$/.test(raw.trim())) return null
  const formatted = formatScaledUsd(raw)
  if (!formatted) return null
  return {
    field: 'VOLUME_24H_USD',
    formatted: `$${formatted}`,
    hint: 'On-chain TaskCompleted emits only the final oracle step (step 4/4). See each step below for price, change %, and market cap when indexed.',
  }
}

export function sentimentStepFieldLabel(stepIdx: number): string | null {
  return SENTIMENT_FIELD_LABELS[stepIdx] ?? null
}
