import { useEffect, useRef, useState } from 'react'

interface TextShimmerProps {
  children: string
  className?: string
  active?: boolean
  offset?: number
}

export function TextShimmer({ children, className, active = true, offset = 0 }: TextShimmerProps) {
  const [run, setRun] = useState(active)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (active) {
      setRun(true)
      return
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setRun(false)
    }, 220)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [active])

  return (
    <span
      data-component="text-shimmer"
      data-active={active ? 'true' : 'false'}
      className={className}
      aria-label={children}
      style={{
        '--text-shimmer-swap': '220ms',
        '--text-shimmer-index': `${offset}`,
      } as React.CSSProperties}
    >
      <span data-slot="text-shimmer-char">
        <span data-slot="text-shimmer-char-base" aria-hidden="true">
          {children}
        </span>
        <span data-slot="text-shimmer-char-shimmer" data-run={run ? 'true' : 'false'} aria-hidden="true">
          {children}
        </span>
      </span>
    </span>
  )
}
