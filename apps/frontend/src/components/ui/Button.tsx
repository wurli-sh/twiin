import { cn } from '@/lib/cn'

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  children: React.ReactNode
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-secondary hover:bg-primary/90 font-bold',
  secondary: 'bg-surface-alt hover:bg-surface-hover text-text border border-border-strong',
  outline: 'border border-border-strong text-text hover:bg-surface-alt bg-transparent',
  danger: 'border border-danger/20 text-danger hover:bg-danger/5 bg-transparent',
}

export function Button({ variant = 'primary', className, children, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100',
        variantStyles[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}
