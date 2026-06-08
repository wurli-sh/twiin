import { NativeConfigId } from '@/config/contracts'
import { formatOracleUsdValue, formatScaledUsd } from '@twiin/shared'

/** Legacy 4-step oracle-only template. */
export const SENTIMENT_ORACLE_STEP_COUNT = 4

/** 4 oracle fetches + reporter snapshot (common Claude plan). */
export const ORACLE_REPORTER_STEP_COUNT = 5

/** Matches buildSomniaCorroboratedTemplate() in the backend planner. */
export const CORROBORATED_SENTIMENT_STEP_COUNT = 7

const SENTIMENT_FIELD_LABELS = [
  'PRICE_USD',
  'CHANGE_24H_PERCENT',
  'MARKET_CAP_USD',
  'VOLUME_24H_USD',
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

/** 2–4 oracle steps followed by a reporter (sentiment/stats templates). */
export function isOracleReporterSentimentTask(
  steps: { configId: number | string }[],
): boolean {
  if (steps.length < 2 || steps.length > ORACLE_REPORTER_STEP_COUNT) return false
  const last = steps[steps.length - 1]
  if (Number(last.configId) !== NativeConfigId.REPORTER) return false
  return steps
    .slice(0, -1)
    .every((s) => Number(s.configId) === NativeConfigId.ORACLE)
}

export function isSentimentOracleTask(
  steps: { configId: number | string }[],
): boolean {
  if (isCorroboratedSentimentTask(steps)) return true
  if (isOracleReporterStatsTask(steps)) return true
  if (isOracleReporterSentimentTask(steps)) return true
  return (
    steps.length === SENTIMENT_ORACLE_STEP_COUNT &&
    steps.every((s) => Number(s.configId) === NativeConfigId.ORACLE)
  )
}

export { formatScaledUsd, formatOracleUsdValue }

export function formatSentimentOracleUsd(
  stepIdx: number,
  raw: string,
): string | null {
  const kind = stepIdx === 0 ? 'spot' : 'large'
  return formatOracleUsdValue(raw, { kind })
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
  const formatted = formatOracleUsdValue(raw, { kind: 'large' })
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
