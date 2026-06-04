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

// Simple hash function to generate deterministic colors
function stringToHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash)
}

export function TwiinAvatar({ name, size = 'sm', className }: TwiinAvatarProps) {
  const avatarStyle = useMemo(() => {
    const hash = stringToHash(name || 'default')
    const h1 = hash % 360
    const h2 = (h1 + 60) % 360
    
    // Sleek gradient for the avatar background
    const background = `linear-gradient(135deg, hsl(${h1}, 80%, 65%) 0%, hsl(${h2}, 85%, 45%) 100%)`
    // Deterministic accent color for the inner glow
    const glowColor = `hsla(${h1}, 90%, 60%, 0.35)`
    
    return { background, boxShadow: `0 0 20px ${glowColor}` }
  }, [name])

  // Get initials (up to 2 letters)
  const initials = useMemo(() => {
    if (!name) return 'TW'
    const cleaned = name.replace(/@twiin/i, '')
    if (cleaned.length <= 2) return cleaned.toUpperCase()
    return cleaned.slice(0, 2).toUpperCase()
  }, [name])

  return (
    <div
      style={avatarStyle}
      className={cn(
        'relative flex items-center justify-center shrink-0 rounded-xl font-bold font-mono text-secondary tracking-tight select-none border border-white/10',
        SIZES[size],
        className
      )}
    >
      <span className="relative z-10 text-black/85 drop-shadow-[0_1px_1px_rgba(255,255,255,0.2)]">
        {initials}
      </span>
      {/* Sleek overlay highlights */}
      <div className="absolute inset-0 rounded-xl bg-gradient-to-tr from-black/20 via-transparent to-white/20 pointer-events-none" />
      <div className="absolute inset-[1.5px] rounded-[10px] border border-white/15 pointer-events-none" />
    </div>
  )
}
