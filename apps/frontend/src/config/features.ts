export const ENABLE_TRUSTLESS_JANICE =
  String(import.meta.env.VITE_ENABLE_TRUSTLESS_JANICE ?? '').toLowerCase() === 'true'

export type ExecutionMode = 'claude' | 'trustless'
