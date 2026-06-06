import { motion } from 'framer-motion'
import { Check, Loader2 } from 'lucide-react'
import { fadeInUp, staggerContainer } from '@/lib/animations'
import { cn } from '@/lib/cn'

const PLAN_STEPS = [
  { title: 'Fetch gas data', status: 'done' as const },
  { title: 'Analyze trends', status: 'active' as const },
  { title: 'Publish feed', status: 'pending' as const },
]

function StepIcon({ status }: { status: 'done' | 'active' | 'pending' }) {
  if (status === 'done') {
    return <Check size={11} className="text-primary" strokeWidth={2.5} aria-hidden />
  }
  if (status === 'active') {
    return <Loader2 size={11} className="animate-spin text-primary" aria-hidden />
  }
  return (
    <span
      className="size-1.5 rounded-full border border-border-strong bg-transparent"
      aria-hidden
    />
  )
}

export function HeroConsolePreview() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none border border-border bg-background"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-1.5 shrink-0 bg-primary-bright" aria-hidden />
          <span className="truncate text-sm font-medium text-foreground">research-bot</span>
        </div>
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Running
        </span>
      </div>

      <motion.div
        className="px-4 py-4"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        <motion.p
          className="text-sm leading-relaxed text-muted-foreground"
          variants={fadeInUp}
        >
          Track ETH gas trends and publish a weekly oracle feed
        </motion.p>

        <motion.ol className="mt-5 space-y-0" variants={fadeInUp}>
          {PLAN_STEPS.map((step, i) => (
            <li
              key={step.title}
              className={cn(
                'flex items-center gap-3 border-t border-border py-2.5',
                step.status === 'active' && 'bg-primary-bright/10',
              )}
            >
              <div className="flex size-4 shrink-0 items-center justify-center">
                <StepIcon status={step.status} />
              </div>
              <p
                className={cn(
                  'text-sm',
                  step.status === 'done' && 'text-muted-foreground',
                  step.status === 'active' && 'font-medium text-foreground',
                  step.status === 'pending' && 'text-muted-foreground/80',
                )}
              >
                <span className="mr-1.5 tabular-nums text-muted-foreground">{i + 1}.</span>
                {step.title}
              </p>
            </li>
          ))}
        </motion.ol>

        <motion.div
          className="mt-4 flex items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground"
          variants={fadeInUp}
        >
          <Loader2 size={12} className="animate-spin text-primary" aria-hidden />
          <span>Keeper executing step 2 of 3</span>
        </motion.div>
      </motion.div>
    </div>
  )
}
