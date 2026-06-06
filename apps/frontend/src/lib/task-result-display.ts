import { decodeNativeAgentResult } from '@twiin/shared'
import {
  describeSentimentCompletion,
  formatScaledUsd,
  isSentimentOracleTask,
  sentimentStepFieldLabel,
} from '@/lib/sentiment-oracle-display'
import type { PlanStep } from '@/lib/plan-api'
import type { TaskStep } from '@/hooks/useTaskDetail'

function looksLikeMarkdown(text: string): boolean {
  return (
    text.includes('**') ||
    text.includes('##') ||
    text.includes('\n- ') ||
    text.length > 200
  )
}

function looksLikeRawUint(raw: string): boolean {
  return /^\d{6,}$/.test(raw.trim())
}

function formatSentimentValue(stepIdx: number, raw: string): string {
  if (stepIdx === 1) {
    const n = Number(raw)
    if (Number.isFinite(n)) return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
    return raw
  }
  const scaled = formatScaledUsd(raw)
  if (scaled) return `$${scaled}`
  return raw
}

export function buildSentimentReportMarkdown(chainSteps: TaskStep[]): string | null {
  if (!isSentimentOracleTask(chainSteps)) return null

  const rows: string[] = []
  for (let i = 0; i < 4; i++) {
    const step = chainSteps.find((s) => s.stepIdx === i)
    const raw = step ? decodeNativeAgentResult(step.resultHex) : null
    const label = sentimentStepFieldLabel(i)?.replace(/ \(.*\)/, '') ?? `Step ${i + 1}`
    if (raw) {
      rows.push(`| ${label.replace(/_/g, ' ')} | ${formatSentimentValue(i, raw)} |`)
    }
  }

  if (rows.length === 0) return null

  return [
    '### Somnia market snapshot',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    ...rows,
    '',
    '_Data from CoinGecko oracle steps._',
  ].join('\n')
}

export function formatTaskResultForDisplay(
  raw: string,
  chainSteps: TaskStep[],
  planSteps?: PlanStep[],
): string {
  const trimmed = raw.trim()
  if (!trimmed) return '_No result returned._'

  if (looksLikeMarkdown(trimmed) && !looksLikeRawUint(trimmed)) {
    return trimmed
  }

  const sentimentFromSteps = buildSentimentReportMarkdown(chainSteps)
  if (sentimentFromSteps) return sentimentFromSteps

  if (
    planSteps &&
    isSentimentOracleTask(planSteps) &&
    looksLikeRawUint(trimmed)
  ) {
    const described = describeSentimentCompletion(trimmed)
    if (described) {
      return [
        '### Somnia market snapshot',
        '',
        `- **${described.field.replace(/_/g, ' ')}:** ${described.formatted}`,
        '',
        `_${described.hint}_`,
      ].join('\n')
    }
  }

  if (looksLikeRawUint(trimmed)) {
    const scaled = formatScaledUsd(trimmed)
    if (scaled) {
      return `**Result:** $${scaled}`
    }
  }

  return trimmed
}
