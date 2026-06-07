import { ShieldCheck } from 'lucide-react'
import { formatEther } from 'viem'
import { cn } from '@/lib/cn'

type Props = {
  validators: number
  medianCostWei?: string | null
  compact?: boolean
  className?: string
}

export function ConsensusBadge({
  validators,
  medianCostWei,
  compact = false,
  className,
}: Props) {
  if (!validators || validators <= 0) return null

  const medianLabel =
    medianCostWei && medianCostWei !== '0'
      ? ` · median ${Number(formatEther(BigInt(medianCostWei))).toFixed(3)} STT`
      : ''

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded border border-success/30 bg-success/10 font-semibold uppercase tracking-wide text-success',
        compact ? 'px-1 py-px text-[9px]' : 'gap-1 px-1.5 py-0.5 text-[10px]',
        className,
      )}
      title="Somnia validator subcommittee agreed on this step"
    >
      <ShieldCheck size={compact ? 10 : 11} />
      {compact
        ? `${validators}v`
        : `${validators} validator${validators === 1 ? '' : 's'} agreed${medianLabel}`}
    </span>
  )
}
