import {
  decodeStepResult,
  formatOracleChangePercent,
  formatOracleUsdValue,
  fixMisscaledSomiPriceInReport,
  ORACLE_METRIC_LABELS,
  rewriteStatsSnapshotFromOracleValues,
  EXTERNAL_MIN_CONFIG_ID,
} from '@twiin/shared'
import { formatEther } from 'viem'
import { NativeConfigId } from '@/config/contracts'
import {
  describeSentimentCompletion,
  isCorroboratedSentimentTask,
  isSentimentOracleTask,
} from '@/lib/sentiment-oracle-display'
import type { PlanStep } from '@/lib/plan-api'
import type { TaskStep } from '@/hooks/useTaskDetail'
import type { StreamEvent } from '@/hooks/useTaskStream'
import { StepState } from '@/config/contracts'
import { configIdLabel } from '@/lib/config-names'

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

function consensusStepFootnote(step: TaskStep | undefined): string {
  if (!step?.consensusValidators) return ''
  const median =
    step.consensusMedianCostWei && step.consensusMedianCostWei !== '0'
      ? `, median ${Number(formatEther(BigInt(step.consensusMedianCostWei))).toFixed(3)} STT`
      : ''
  return ` (${step.consensusValidators} validators${median})`
}

type OracleMetricRow = {
  label: string
  formatted: string
  step: TaskStep
}

function collectOracleMetricRows(chainSteps: TaskStep[]): OracleMetricRow[] {
  const oracleSteps = chainSteps
    .filter((s) => Number(s.configId) === NativeConfigId.ORACLE)
    .sort((a, b) => a.stepIdx - b.stepIdx)

  const rows: OracleMetricRow[] = []
  for (let i = 0; i < oracleSteps.length; i++) {
    const step = oracleSteps[i]
    const raw = decodeStepResult(step.resultHex)
    if (!raw?.trim()) continue

    const label = ORACLE_METRIC_LABELS[i] ?? `Metric ${i + 1}`
    let formatted: string
    if (i === 1) {
      formatted = formatOracleChangePercent(raw)
    } else if (i === 0) {
      const value = formatOracleUsdValue(raw, { kind: 'spot' })
      formatted = value ? `$${value}` : raw
    } else {
      const value = formatOracleUsdValue(raw, { kind: 'large' })
      formatted = value ? `$${value}` : raw
    }
    rows.push({ label, formatted, step })
  }
  return rows
}

function extractReporterFootnote(chainSteps: TaskStep[]): string | undefined {
  const reporter = chainSteps.find(
    (s) => Number(s.configId) === NativeConfigId.REPORTER,
  )
  const text = reporter ? decodeStepResult(reporter.resultHex) : null
  if (!text?.trim()) return undefined

  const noteLine = text
    .split('\n')
    .map((line) => line.trim())
    .find(
      (line) =>
        /^note:/i.test(line) ||
        /single-source/i.test(line) ||
        /does not include external analysis/i.test(line),
    )
  if (!noteLine) return undefined
  return noteLine.replace(/^note:\s*/i, '').replace(/^_/, '').replace(/_$/, '')
}

export function buildOracleMetricsSnapshot(chainSteps: TaskStep[]): string | null {
  const rows = collectOracleMetricRows(chainSteps)
  if (rows.length === 0) return null

  const title =
    rows.length >= 4 ? 'Somnia stats snapshot' : 'Somnia sentiment snapshot'
  const footnote =
    extractReporterFootnote(chainSteps) ??
    'Lower-budget single-source oracle summary.'

  return [
    `### ${title}`,
    '',
    ...rows.map(
      (row) =>
        `- **${row.label}:** ${row.formatted}${consensusStepFootnote(row.step)}`,
    ),
    '',
    `_${footnote}_`,
    '_Data from CoinGecko oracle steps._',
  ].join('\n')
}

export function buildReporterReportFromSteps(chainSteps: TaskStep[]): string | null {
  const reporter = chainSteps.find(
    (s) => Number(s.configId) === NativeConfigId.REPORTER,
  )
  if (!reporter) return null
  const text = decodeStepResult(reporter.resultHex)
  if (!text?.trim()) return null

  const oracleRows = collectOracleMetricRows(chainSteps)
  const rewritten =
    oracleRows.length > 0
      ? rewriteStatsSnapshotFromOracleValues(
          text,
          oracleRows.map((row) => ({
            label: row.label,
            formatted: row.formatted,
          })),
        )
      : fixMisscaledSomiPriceInReport(text)

  if (looksLikeMarkdown(rewritten)) return rewritten
  if (rewritten.length > 40) {
    const body = rewritten.startsWith('#')
      ? rewritten
      : `### Somnia stats snapshot\n\n${rewritten}`
    return fixMisscaledSomiPriceInReport(body)
  }
  return null
}

/** @deprecated Use buildOracleMetricsSnapshot */
export function buildOracleMetricsTable(chainSteps: TaskStep[]): string | null {
  const rows = collectOracleMetricRows(chainSteps)
  if (rows.length === 0) return null

  return [
    '### Somnia market snapshot',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    ...rows.map(
      (row) =>
        `| ${row.label} | ${row.formatted}${consensusStepFootnote(row.step)} |`,
    ),
    '',
    '_Data from CoinGecko oracle steps._',
  ].join('\n')
}

export function buildSentimentReportMarkdown(chainSteps: TaskStep[]): string | null {
  if (!isSentimentOracleTask(chainSteps)) return null

  const oracleSnapshot = buildOracleMetricsSnapshot(chainSteps)

  if (isCorroboratedSentimentTask(chainSteps)) {
    const reporter = chainSteps.find((s) => s.stepIdx === chainSteps.length - 1)
    const analysis = chainSteps.find((s) => s.stepIdx === chainSteps.length - 2)
    const reporterText = reporter ? decodeStepResult(reporter.resultHex) : null
    const analysisText = analysis ? decodeStepResult(analysis.resultHex) : null
    if (reporterText) {
      const oracleRows = collectOracleMetricRows(chainSteps)
      const body =
        oracleRows.length > 0
          ? rewriteStatsSnapshotFromOracleValues(
              reporterText,
              oracleRows.map((row) => ({
                label: row.label,
                formatted: row.formatted,
              })),
            )
          : fixMisscaledSomiPriceInReport(reporterText)
      return [
        '### Somnia corroborated snapshot',
        '',
        body,
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

  if (oracleSnapshot) return oracleSnapshot

  const reporterText = buildReporterReportFromSteps(chainSteps)
  if (reporterText) return reporterText

  return buildOracleMetricsTable(chainSteps)
}

export function buildExternalReportFromSteps(chainSteps: TaskStep[]): string | null {
  const hasReporter = chainSteps.some(
    (s) => Number(s.configId) === NativeConfigId.REPORTER,
  )
  if (hasReporter) return null

  const externalSteps = chainSteps
    .filter((s) => Number(s.configId) >= EXTERNAL_MIN_CONFIG_ID)
    .sort((a, b) => a.stepIdx - b.stepIdx)

  for (let i = externalSteps.length - 1; i >= 0; i--) {
    const text = decodeStepResult(externalSteps[i]?.resultHex)
    if (!text?.trim()) continue
    if (looksLikeMarkdown(text) || text.length > 120) return text
  }

  return null
}

export function resolveTaskReportText(
  rawResult: string | undefined,
  chainSteps: TaskStep[],
  planSteps?: PlanStep[],
): string | null {
  const fromSteps = buildSentimentReportMarkdown(chainSteps)
  if (fromSteps && !isPlaceholderResult(fromSteps)) return fromSteps

  const externalReport = buildExternalReportFromSteps(chainSteps)
  if (externalReport) return externalReport

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
    const scaled = formatOracleUsdValue(trimmed, { kind: 'spot' })
    if (scaled) {
      return `**Result:** $${scaled}`
    }
  }

  return trimmed
}

export type AbortDetail = {
  chainReason: string
  stepIdx?: number
  agentName?: string
  score?: number
  ratingReason?: string
}

export function buildAbortResultText(detail: AbortDetail): string {
  const lines = [`**${detail.chainReason}**`]
  if (detail.stepIdx != null) {
    const agent = detail.agentName ? ` (${detail.agentName})` : ''
    lines.push(`Failed at step ${detail.stepIdx + 1}${agent}`)
  }
  if (detail.score != null) {
    lines.push(`Quality score: **${detail.score}/100** (minimum 40 required)`)
  }
  if (detail.ratingReason) {
    lines.push(`Rater: ${detail.ratingReason}`)
  }
  return lines.join('\n\n')
}

function firstTerminalStep(chainSteps: TaskStep[]): TaskStep | undefined {
  return chainSteps
    .filter(
      (step) =>
        step.state === StepState.Failed || step.state === StepState.TimedOut,
    )
    .sort((a, b) => a.stepIdx - b.stepIdx)[0]
}

export function resolveAbortDetail(
  events: StreamEvent[],
  chainSteps: TaskStep[],
  chainReason?: string,
): AbortDetail {
  const reason = chainReason ?? 'Task aborted'
  const isTimeout = /timed?\s*out|timeout/i.test(reason)

  const rejected = [...events]
    .reverse()
    .find(
      (event) =>
        event.type === 'step_rejected' ||
        (event.type === 'step_rated' && event.data.approved === false),
    )

  if (isTimeout) {
    const failedStep = firstTerminalStep(chainSteps)
    return {
      chainReason: reason,
      stepIdx: failedStep?.stepIdx,
      agentName: failedStep
        ? configIdLabel(Number(failedStep.configId))
        : undefined,
    }
  }

  if (rejected) {
    const stepIdx =
      typeof rejected.data.stepIdx === 'number'
        ? rejected.data.stepIdx
        : undefined
    const step =
      stepIdx != null
        ? chainSteps.find((s) => s.stepIdx === stepIdx)
        : undefined
    return {
      chainReason: reason,
      stepIdx,
      agentName: step ? configIdLabel(Number(step.configId)) : undefined,
      score:
        typeof rejected.data.score === 'number'
          ? rejected.data.score
          : undefined,
      ratingReason:
        typeof rejected.data.reason === 'string'
          ? rejected.data.reason
          : undefined,
    }
  }

  const failedStep = firstTerminalStep(chainSteps)
  return {
    chainReason: reason,
    stepIdx: failedStep?.stepIdx,
    agentName: failedStep
      ? configIdLabel(Number(failedStep.configId))
      : undefined,
  }
}
