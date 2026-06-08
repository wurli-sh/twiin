import { motion } from 'framer-motion'
import { Activity, Check, Loader2 } from 'lucide-react'
import { getHeroPrompt, formatPromptSubtitle } from '@twiin/shared'
import { fadeInUp, staggerContainer } from '@/lib/animations'
import { cn } from '@/lib/cn'

const heroPrompt = getHeroPrompt()
const ACTIVE_STEP_INDEX = 3

type StepStatus = 'done' | 'active' | 'pending'

function formatWorkflowLabel(name: string): string {
  if (name.includes('@twiin')) return name
  return `${name}@twiin`
}

function stepStatus(index: number): StepStatus {
  if (index < ACTIVE_STEP_INDEX) return 'done'
  if (index === ACTIVE_STEP_INDEX) return 'active'
  return 'pending'
}

const PLAN_STEPS = heroPrompt.workflow.map((name, index) => ({
  title: formatWorkflowLabel(name),
  status: stepStatus(index),
}))

function StepIcon({ status }: { status: StepStatus }) {
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
      className="pointer-events-none overflow-hidden rounded-xl border border-border bg-background shadow-card"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Activity size={14} className="shrink-0 text-primary" aria-hidden />
          <span className="truncate text-sm font-medium text-foreground">{heroPrompt.label}</span>
          <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-foreground">
            {heroPrompt.budgetStt} STT
          </span>
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
          className="text-[10px] text-muted-foreground/80"
          variants={fadeInUp}
        >
          {formatPromptSubtitle(heroPrompt)}
        </motion.p>

        <motion.p
          className="mt-2 text-sm leading-relaxed text-muted-foreground"
          variants={fadeInUp}
        >
          {heroPrompt.goal}
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
          <span>
            Keeper executing step {ACTIVE_STEP_INDEX + 1} of {heroPrompt.stepCount}
          </span>
        </motion.div>
      </motion.div>
    </div>
  )
}
