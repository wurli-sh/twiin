import { motion } from 'framer-motion'
import { Sparkles, Shield } from 'lucide-react'
import type { ExecutionMode } from '@/config/features'
import { executionModeClasses } from '@/lib/execution-mode-theme'
import { cn } from '@/lib/cn'

type Props = {
  mode: ExecutionMode
  onChange: (mode: ExecutionMode) => void
  disabled?: boolean
  compact?: boolean
  className?: string
}

const OPTIONS: {
  value: ExecutionMode
  label: string
  shortLabel: string
  icon: typeof Sparkles
}[] = [
  { value: 'claude', label: 'Claude Plan', shortLabel: 'Claude', icon: Sparkles },
  { value: 'trustless', label: 'Trustless Janice', shortLabel: 'Trustless', icon: Shield },
]

export function ExecutionModeToggle({
  mode,
  onChange,
  disabled = false,
  compact = false,
  className,
}: Props) {
  const layoutId = compact ? 'execution-mode-pill-compact' : 'execution-mode-pill'

  return (
    <div
      role="group"
      aria-label="Execution mode"
      className={cn(
        'relative inline-flex rounded-lg border border-border-strong bg-muted/40 p-0.5',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      {OPTIONS.map((option) => {
        const isActive = mode === option.value
        const styles = executionModeClasses(option.value, isActive)
        const Icon = option.icon
        const label = compact ? option.shortLabel : option.label

        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative z-10 flex cursor-pointer items-center justify-center gap-1.5 rounded-md font-medium outline-none transition-colors duration-200',
              styles.ring,
              compact ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-1.5 text-xs',
              styles.text,
            )}
          >
            {isActive && (
              <motion.span
                layoutId={layoutId}
                className={cn('absolute inset-0 rounded-md', styles.pill)}
                transition={{ type: 'spring', stiffness: 480, damping: 34 }}
              />
            )}
            <Icon
              size={compact ? 11 : 12}
              className={cn('relative z-10 shrink-0', styles.icon)}
              strokeWidth={2.25}
            />
            <span className="relative z-10 whitespace-nowrap">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
