const NAME_RE = /^[a-z0-9-]{3,32}$/

export function normalizeAgentName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/@twiin$/i, '')
    .replace(/\s+/g, '-')
}

export function validateAgentName(name: string): string | null {
  if (!name) return 'Name is required'
  if (!NAME_RE.test(name)) {
    return 'Use 3–32 lowercase letters, numbers, or hyphens'
  }
  return null
}

export function formatAgentLabel(name: string, id: bigint): string {
  if (name && name !== `Agent #${id}`) return `${name}@twiin`
  return `#${id.toString()}`
}
