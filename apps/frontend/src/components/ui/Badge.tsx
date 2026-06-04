import { cn } from '@/lib/cn'

type BadgeVariant = 'default' | 'success' | 'danger' | 'warning'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-primary/20 text-primary border border-primary/20',
  success: 'bg-success/10 text-success border border-success/25',
  danger: 'bg-danger/10 text-danger border border-danger/25',
  warning: 'bg-warning/10 text-warning border border-warning/25',
}

export function Badge({ variant = 'default', className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-lg px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
