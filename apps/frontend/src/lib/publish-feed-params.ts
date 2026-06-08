import { decodeStepResult, NativeConfigId } from '@twiin/shared'
import type { TaskStep } from '@/hooks/useTaskDetail'

export type PublishFeedParams = {
  topic: string
  value: string
  confidence: number
}

function parseConfidence(text: string): number | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const raw =
      typeof parsed.confidence === 'number'
        ? parsed.confidence
        : typeof parsed.score === 'number'
          ? parsed.score
          : null
    if (raw == null) return null
    return Math.min(100, Math.max(0, Math.round(raw)))
  } catch {
    const match = text.match(/(?:confidence|score)\D{0,12}(\d{1,3})/i)
    if (!match) return null
    return Math.min(100, Math.max(0, Number.parseInt(match[1] ?? '0', 10)))
  }
}

/** Derive oracle publish inputs from completed task steps (analysis + optional brief). */
export function extractPublishFeedParams(
  chainSteps: TaskStep[],
  reportText?: string | null,
): PublishFeedParams | null {
  const analysis = chainSteps.find(
    (s) => Number(s.configId) === NativeConfigId.ANALYSIS,
  )
  const analysisText = analysis ? decodeStepResult(analysis.resultHex) : null
  if (!analysisText?.trim()) return null

  const confidence = parseConfidence(analysisText)
  if (confidence == null) return null

  const valueSource =
    reportText?.trim() ||
    chainSteps
      .slice()
      .reverse()
      .map((s) => decodeStepResult(s.resultHex))
      .find((text) => text && text.length > 20) ||
    analysisText

  const value =
    valueSource.length > 1024 ? `${valueSource.slice(0, 1021)}...` : valueSource

  return {
    topic: 'agent-brief',
    value,
    confidence,
  }
}
