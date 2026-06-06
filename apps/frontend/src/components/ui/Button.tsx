import { cn } from '@/lib/cn'

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  children: React.ReactNode
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'pill-gradient bg-charcoal text-white shadow-pill hover:bg-charcoal-soft active:scale-[0.97]',
  secondary:
    'pill-gradient bg-primary-bright text-primary shadow-lime-pill hover:opacity-90 active:scale-[0.97]',
  outline:
    'border border-border bg-background text-foreground shadow-soft hover:bg-muted active:scale-[0.97]',
  danger:
    'border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15 active:scale-[0.97]',
}

const sizeStyles = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-5 py-2.5 text-sm',
  lg: 'px-6 py-3 text-base',
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 font-semibold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
