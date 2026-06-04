import { useEffect, useState } from 'react'

/** Brief gate so skeleton layouts can flash before wallet/RPC hooks settle. */
export function usePageReady(delayMs = 120): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), delayMs)
    return () => window.clearTimeout(t)
  }, [delayMs])

  return ready
}
