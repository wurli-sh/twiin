import { NativeConfigId } from '@/config/contracts'

/** Legacy 4-step oracle-only template. */
export const SENTIMENT_ORACLE_STEP_COUNT = 4

/** 4 oracle fetches + reporter snapshot (common Claude plan). */
export const ORACLE_REPORTER_STEP_COUNT = 5

/** Matches buildSomniaCorroboratedTemplate() in the backend planner. */
export const CORROBORATED_SENTIMENT_STEP_COUNT = 7

const SENTIMENT_FIELD_LABELS = [
  'PRICE_USD (8 decimals)',
  'CHANGE_24H_PERCENT',
  'MARKET_CAP_USD (8 decimals)',
  'VOLUME_24H_USD (8 decimals)',
] as const

export function isCorroboratedSentimentTask(
  steps: { configId: number | string }[],
): boolean {
  return steps.length === CORROBORATED_SENTIMENT_STEP_COUNT
}

export function isOracleReporterStatsTask(
  steps: { configId: number | string }[],
): boolean {
  return (
    steps.length === ORACLE_REPORTER_STEP_COUNT &&
    steps
      .slice(0, ORACLE_REPORTER_STEP_COUNT - 1)
      .every((s) => Number(s.configId) === NativeConfigId.ORACLE) &&
    Number(steps[ORACLE_REPORTER_STEP_COUNT - 1]?.configId) === NativeConfigId.REPORTER
  )
}

export function isSentimentOracleTask(
  steps: { configId: number | string }[],
): boolean {
  if (isCorroboratedSentimentTask(steps)) return true
  if (isOracleReporterStatsTask(steps)) return true
  return (
    steps.length === SENTIMENT_ORACLE_STEP_COUNT &&
    steps.every((s) => Number(s.configId) === NativeConfigId.ORACLE)
  )
}

/** Decode a Somnia oracle uint256 scaled with 8 decimals (CoinGecko planner default). */
export function formatScaledUsd(raw: string, decimals = 8): string | null {
  const digits = raw.trim()
  if (!/^\d+$/.test(digits)) return null

  const normalized = digits.replace(/^0+(?=\d)/, '')
  const padded = normalized.padStart(decimals + 1, '0')
  const whole = padded.slice(0, -decimals) || '0'
  const fraction = padded.slice(-decimals)

  // Guard against mislabeling arbitrary raw payloads as dollar values.
  if (whole.replace(/^0+/, '').length > 15) return null

  const wholeNumber = BigInt(whole)
  if (wholeNumber >= 1n) {
    const cents = fraction.slice(0, 2).replace(/0+$/, '')
    const formattedWhole = wholeNumber.toLocaleString()
    return cents ? `${formattedWhole}.${cents}` : formattedWhole
  }

  const firstSignificant = fraction.search(/[1-9]/)
  if (firstSignificant === -1) return '0'
  const precision = Math.min(fraction.length, firstSignificant + 4)
  const trimmedFraction = fraction.slice(0, precision).replace(/0+$/, '')
  return trimmedFraction ? `0.${trimmedFraction}` : '0'
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
