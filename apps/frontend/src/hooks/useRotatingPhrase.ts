import { useEffect, useState } from 'react'

const DEFAULT_INTERVAL_MS = 2500

export function useRotatingPhrase(phrases: string[], intervalMs = DEFAULT_INTERVAL_MS): string {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    setIndex(0)
  }, [phrases.join('\0')])

  useEffect(() => {
    if (phrases.length <= 1) return

    const timer = window.setInterval(() => {
      setIndex((i) => (i + 1) % phrases.length)
    }, intervalMs)

    return () => window.clearInterval(timer)
  }, [phrases, intervalMs])

  return phrases[index] ?? phrases[0] ?? ''
}
