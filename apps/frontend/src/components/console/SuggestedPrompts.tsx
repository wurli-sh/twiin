import { motion } from 'framer-motion'
import { Activity, BarChart3, Receipt, Shield, ShieldCheck, type LucideIcon } from 'lucide-react'
import {
  CONSOLE_PROMPTS,
  formatPromptSubtitle,
  type ConsolePromptDef,
  type ConsolePromptId,
} from '@twiin/shared'

const ICON_BY_ID: Record<ConsolePromptId, LucideIcon> = {
  'lp-risk': Shield,
  'lp-risk-native': ShieldCheck,
  ecosystem: BarChart3,
  receipt: Receipt,
  chain: Activity,
}

type Props = {
  disabled?: boolean
  onSelect: (prompt: ConsolePromptDef) => void
}

export function SuggestedPrompts({ disabled, onSelect }: Props) {
  return (
    <div className="mx-auto mt-3 flex max-w-2xl flex-wrap items-center justify-center gap-2">
      {CONSOLE_PROMPTS.map((p, i) => {
        const Icon = ICON_BY_ID[p.id]
        return (
          <motion.button
            key={p.id}
            type="button"
            disabled={disabled}
            title={p.description}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 + i * 0.06, duration: 0.25 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onSelect(p)}
            className="flex cursor-pointer flex-col items-start gap-0.5 rounded-lg border border-border-strong px-3.5 py-2 text-left transition-all duration-150 hover:border-primary hover:bg-primary-bright/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary">
              <Icon size={13} />
              {p.label}
              <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-foreground">
                {p.budgetStt} STT
              </span>
            </span>
            <span className="pl-5 text-[10px] text-muted-foreground/80">
              {formatPromptSubtitle(p)}
            </span>
          </motion.button>
        )
      })}
    </div>
  )
}
