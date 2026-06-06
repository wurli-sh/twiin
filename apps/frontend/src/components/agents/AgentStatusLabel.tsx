import { cn } from '@/lib/cn'

type Props = {
  frozen: boolean
  className?: string
}

export function AgentStatusLabel({ frozen, className }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide',
        frozen ? 'text-destructive' : 'text-primary',
        className,
      )}
    >
      <span
        className={cn('size-1.5 shrink-0', frozen ? 'bg-destructive' : 'bg-primary-bright')}
        aria-hidden
      />
      {frozen ? 'Frozen' : 'Active'}
    </span>
  )
}
