import { NativeConfigId } from '@/config/contracts'

const NATIVE_NAMES: Record<number, string> = {
  [NativeConfigId.JANICE]: 'janice@twiin',
  [NativeConfigId.WEB_INTEL]: 'web-intel@twiin',
  [NativeConfigId.ORACLE]: 'somnia-oracle@twiin',
  [NativeConfigId.ANALYSIS]: 'analysis-bot@twiin',
  [NativeConfigId.REPORTER]: 'reporter-bot@twiin',
  [NativeConfigId.EXECUTOR]: 'executor@twiin',
}

export function configIdLabel(configId: number, fallback?: string): string {
  return NATIVE_NAMES[configId] ?? fallback ?? `agent #${configId}`
}
