import { cn } from '@/lib/cn'

type BadgeVariant = 'default' | 'success' | 'danger' | 'warning'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-primary-bright/30 text-primary border border-primary/20',
  success: 'bg-success-soft text-success border border-success/25',
  danger: 'bg-danger-soft text-destructive border border-destructive/25',
  warning: 'bg-warning/10 text-warning border border-warning/25',
}

export function Badge({ variant = 'default', className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}
