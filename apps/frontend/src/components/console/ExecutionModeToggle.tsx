import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/cn'

type Props = {
  className?: string
}

export function ExecutionModeToggle({ className }: Props) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-border-strong px-2.5 py-1 text-[11px] font-medium text-muted-foreground',
        className,
      )}
    >
      <Sparkles size={11} strokeWidth={2.25} />
      Claude Plan
    </div>
  )
}
