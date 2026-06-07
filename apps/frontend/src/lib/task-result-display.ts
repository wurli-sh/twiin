import { decodeNativeAgentResult } from '@twiin/shared'
import { formatEther } from 'viem'
import { NativeConfigId } from '@/config/contracts'
import {
  describeSentimentCompletion,
  formatScaledUsd,
  isCorroboratedSentimentTask,
  isSentimentOracleTask,
  sentimentStepFieldLabel,
} from '@/lib/sentiment-oracle-display'
import type { PlanStep } from '@/lib/plan-api'
import type { TaskStep } from '@/hooks/useTaskDetail'

const PLACEHOLDER_RESULTS = new Set([
  '',
  'Task completed.',
  'Task completed',
  '_No result returned._',
])

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

function isPlaceholderResult(text: string | null | undefined): boolean {
  if (!text) return true
  return PLACEHOLDER_RESULTS.has(text.trim())
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

function consensusStepFootnote(step: TaskStep | undefined): string {
  if (!step?.consensusValidators) return ''
  const median =
    step.consensusMedianCostWei && step.consensusMedianCostWei !== '0'
      ? `, median ${Number(formatEther(BigInt(step.consensusMedianCostWei))).toFixed(3)} STT`
      : ''
  return ` (${step.consensusValidators} validators${median})`
}

export function buildReporterReportFromSteps(chainSteps: TaskStep[]): string | null {
  const reporter =
    chainSteps.find((s) => Number(s.configId) === NativeConfigId.REPORTER) ??
    chainSteps[chainSteps.length - 1]
  const text = decodeNativeAgentResult(reporter?.resultHex)
  if (!text?.trim()) return null

  if (looksLikeMarkdown(text)) return text
  if (text.length > 40) {
    return text.startsWith('#') ? text : `### Somnia stats snapshot\n\n${text}`
  }
  return null
}

export function buildOracleMetricsTable(chainSteps: TaskStep[]): string | null {
  const rows: string[] = []

  for (let i = 0; i < 4; i++) {
    const step = chainSteps.find((s) => s.stepIdx === i)
    const raw = step ? decodeNativeAgentResult(step.resultHex) : null
    const label = sentimentStepFieldLabel(i)?.replace(/ \(.*\)/, '') ?? `Step ${i + 1}`
    if (raw) {
      rows.push(
        `| ${label.replace(/_/g, ' ')} | ${formatSentimentValue(i, raw)}${consensusStepFootnote(step)} |`,
      )
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

export function buildSentimentReportMarkdown(chainSteps: TaskStep[]): string | null {
  if (!isSentimentOracleTask(chainSteps)) return null

  if (isCorroboratedSentimentTask(chainSteps)) {
    const reporter = chainSteps.find((s) => s.stepIdx === chainSteps.length - 1)
    const analysis = chainSteps.find((s) => s.stepIdx === chainSteps.length - 2)
    const reporterText = reporter ? decodeNativeAgentResult(reporter.resultHex) : null
    const analysisText = analysis ? decodeNativeAgentResult(analysis.resultHex) : null
    if (reporterText) {
      return [
        '### Somnia corroborated snapshot',
        '',
        reporterText,
        '',
        analysisText ? `_Analysis: ${analysisText.slice(0, 280)}_` : '',
        '',
        '_Corroborated across web parse + JSON oracle + analysis (consensus-verified native steps)._',
        ...chainSteps
          .filter((s) => s.consensusValidators)
          .map(
            (s) =>
              `- Step ${s.stepIdx + 1}: ${s.consensusValidators} validators agreed${consensusStepFootnote(s)}`,
          ),
      ]
        .filter(Boolean)
        .join('\n')
    }
  }

  const reporterText = buildReporterReportFromSteps(chainSteps)
  const metricsTable = buildOracleMetricsTable(chainSteps)

  if (reporterText && metricsTable) {
    return `${reporterText}\n\n---\n\n${metricsTable}`
  }
  if (reporterText) return reporterText
  if (metricsTable) return metricsTable

  return null
}

export function resolveTaskReportText(
  rawResult: string | undefined,
  chainSteps: TaskStep[],
  planSteps?: PlanStep[],
): string | null {
  const fromSteps = buildSentimentReportMarkdown(chainSteps)
  if (fromSteps && !isPlaceholderResult(fromSteps)) return fromSteps

  const reporterOnly = buildReporterReportFromSteps(chainSteps)
  if (reporterOnly) return reporterOnly

  const metricsOnly = buildOracleMetricsTable(chainSteps)
  if (metricsOnly) return metricsOnly

  const trimmed = rawResult?.trim() ?? ''
  if (trimmed && !isPlaceholderResult(trimmed)) {
    const formatted = formatTaskResultForDisplay(trimmed, chainSteps, planSteps)
    if (!isPlaceholderResult(formatted)) return formatted
  }

  return null
}

export function isTaskReportReady(
  rawResult: string | undefined,
  chainSteps: TaskStep[],
  planSteps?: PlanStep[],
): boolean {
  return resolveTaskReportText(rawResult, chainSteps, planSteps) != null
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
