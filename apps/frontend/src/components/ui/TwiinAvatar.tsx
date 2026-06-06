import { useMemo } from 'react'
import { cn } from '@/lib/cn'

interface TwiinAvatarProps {
  name: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const SIZES = {
  sm: 'size-7 text-[10px]',
  md: 'size-10 text-xs',
  lg: 'size-16 text-lg',
  xl: 'size-24 text-2xl',
}

/** Curated bright tints — light backgrounds with saturated matching initials */
const AVATAR_PALETTES = [
  { bg: '#E8F9D0', fg: '#2F5F14', border: '#C5F08A' },
  { bg: '#D8F1FF', fg: '#0C5A8F', border: '#93D5F8' },
  { bg: '#FFE8D4', fg: '#B45309', border: '#FDBA74' },
  { bg: '#EDE8FF', fg: '#5B21B6', border: '#C4B5FD' },
  { bg: '#D8FAE8', fg: '#047857', border: '#6EE7B7' },
  { bg: '#FFE4EE', fg: '#BE185D', border: '#FDA4AF' },
  { bg: '#FEF3C7', fg: '#A16207', border: '#FCD34D' },
  { bg: '#CFF7FE', fg: '#0E7490', border: '#67E8F9' },
  { bg: '#FFEDD5', fg: '#C2410C', border: '#FDBA74' },
  { bg: '#E0F2FE', fg: '#0369A1', border: '#7DD3FC' },
  { bg: '#F3E8FF', fg: '#7C3AED', border: '#D8B4FE' },
  { bg: '#ECFCCB', fg: '#4D7C0F', border: '#BEF264' },
] as const

function stringToHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash)
}

function paletteForName(name: string) {
  const hash = stringToHash(name || 'default')
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length]
}

export function TwiinAvatar({ name, size = 'sm', className }: TwiinAvatarProps) {
  const palette = useMemo(() => paletteForName(name), [name])

  const initials = useMemo(() => {
    if (!name) return 'TW'
    const cleaned = name.replace(/@twiin/i, '')
    if (cleaned.length <= 2) return cleaned.toUpperCase()
    return cleaned.slice(0, 2).toUpperCase()
  }, [name])

  return (
    <div
      style={{
        backgroundColor: palette.bg,
        color: palette.fg,
        borderColor: palette.border,
      }}
      className={cn(
        'flex shrink-0 select-none items-center justify-center border font-mono font-bold tracking-tight',
        SIZES[size],
        className,
      )}
    >
      {initials}
    </div>
  )
}
