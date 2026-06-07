import type { SessionEntry } from '@/lib/console-session'

const STORAGE_KEY = 'twiin.console.pending-session'

type PersistedSession = {
  agentId: string | null
  entries: SessionEntry[]
}

export function loadPersistedSession(agentId: string | null): SessionEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as PersistedSession
    if (parsed.agentId !== agentId) return []
    const hasPendingPlan = parsed.entries.some(
      (entry) => entry.kind === 'plan' && entry.status === 'pending',
    )
    return hasPendingPlan ? parsed.entries : []
  } catch {
    return []
  }
}

export function persistSession(
  agentId: string | null,
  entries: SessionEntry[],
): void {
  if (typeof window === 'undefined') return
  const hasPendingPlan = entries.some(
    (entry) => entry.kind === 'plan' && entry.status === 'pending',
  )
  if (!hasPendingPlan) {
    window.localStorage.removeItem(STORAGE_KEY)
    return
  }
  const payload: PersistedSession = { agentId, entries }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

export function clearPersistedSession(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(STORAGE_KEY)
}
