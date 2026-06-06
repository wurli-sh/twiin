import { NativeConfigId } from '@/config/contracts'
import { configIdLabel } from '@/lib/config-names'
import { formatAgentLabel } from '@/lib/agent-name'
import type { SubAgentInfo } from '@/hooks/useSubAgents'
import {
  isSentimentOracleTask,
  sentimentStepFieldLabel,
} from '@/lib/sentiment-oracle-display'
import type { PlanStep } from '@/lib/plan-api'

const ROLE_SHORT: Record<number, string> = {
  [NativeConfigId.WEB_INTEL]: 'Scrape',
  [NativeConfigId.ORACLE]: 'Fetch',
  [NativeConfigId.ANALYSIS]: 'Analyze',
  [NativeConfigId.REPORTER]: 'Report',
}

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

function humanizeSelector(selector: string): string {
  return selector
    .replace(/^somnia\./, '')
    .replace(/_/g, ' ')
    .replace(/\./g, ' · ')
}

export type PlanStepDescription = {
  title: string
  detail: string
  agent: string
}

export type SubAgentRef = {
  label: string
  configId: number
  lane?: SubAgentInfo['lane']
}

export function resolveSubAgentRef(
  configId: number,
  subAgents?: SubAgentInfo[],
): SubAgentRef {
  const registry = subAgents?.find((a) => a.configId === configId)
  if (registry?.name) {
    return {
      label: formatAgentLabel(registry.name, BigInt(configId)),
      configId,
      lane: registry.lane,
    }
  }
  return {
    label: configIdLabel(configId),
    configId,
    lane: registry?.lane,
  }
}

export function planStepTaskDetail(detail: string, agent: string): string | null {
  const trimmed = detail.trim()
  if (!trimmed || trimmed === agent) return null
  return trimmed
}

export function describePlanStep(
  step: PlanStep,
  stepIdx: number,
  allSteps: PlanStep[],
): PlanStepDescription {
  const agent = configIdLabel(step.configId)
  const role = ROLE_SHORT[step.configId] ?? 'Run'

  if (isSentimentOracleTask(allSteps)) {
    const field = sentimentStepFieldLabel(stepIdx)
    if (field) {
      const short = field.replace(/ \(.*\)/, '').replace(/_/g, ' ')
      return {
        title: `${role} ${short.toLowerCase()}`,
        detail: 'CoinGecko · Somnia market data',
        agent,
      }
    }
  }

  try {
    const parsed = JSON.parse(step.payload) as Record<string, unknown>
    if (step.configId === NativeConfigId.ORACLE) {
      const selector = String(parsed.selector ?? '')
      return {
        title: `${role} ${humanizeSelector(selector) || 'oracle data'}`,
        detail: agent,
        agent,
      }
    }
    if (step.configId === NativeConfigId.WEB_INTEL) {
      const url = String(parsed.url ?? '')
      let host = ''
      try {
        host = new URL(url).hostname.replace(/^www\./, '')
      } catch {
        /* ignore */
      }
      const prompt = String(parsed.prompt ?? '')
      return {
        title: host ? `${role} ${host}` : role,
        detail: prompt ? truncate(prompt, 64) : agent,
        agent,
      }
    }
  } catch {
    /* plain-text payload */
  }

  const plain = step.payload.trim()
  if (
    step.configId === NativeConfigId.ANALYSIS ||
    step.configId === NativeConfigId.REPORTER
  ) {
    return {
      title: role,
      detail: truncate(plain, 72) || agent,
      agent,
    }
  }

  return {
    title: role,
    detail: plain ? truncate(plain, 64) : agent,
    agent,
  }
}

