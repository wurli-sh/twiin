export function formatFeedAge(timestampSec: number): string {
  if (!timestampSec) return 'Never published'
  const ageMs = Date.now() - timestampSec * 1000
  if (ageMs < 0) return 'Just now'
  const sec = Math.floor(ageMs / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 48) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  return `${days}d ago`
}

export function formatDuration(seconds: number): string {
  if (!seconds) return '—'
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`
  return `${(seconds / 86400).toFixed(1)}d`
}
