import { motion } from 'framer-motion'
import { BarChart3, Brain, Search, Sparkles } from 'lucide-react'

const PROMPT_META = [
  {
    icon: BarChart3,
    label: 'Ecosystem stats',
    text: 'Fetch Somnia ecosystem stats: price, 24h change, market cap, and 24h volume. Budget: 0.75 STT',
  },
  {
    icon: Search,
    label: 'Research LP',
    text: 'Research dreamDEX and tell me whether providing liquidity there is a good idea, including risks, opportunities, and any missing data.',
  },
  {
    icon: Brain,
    label: 'Daily sentiment',
    text: 'Fetch current Somnia market sentiment and summarize the price, 24h change, market cap, and 24h volume.',
  },
  {
    icon: Sparkles,
    label: 'Agent task',
    text: 'Run a quick on-chain research task for my agent and return a short summary with the main findings. Budget: 1 STT',
  },
]

type Props = {
  disabled?: boolean
  onSelect: (prompt: string) => void
}

export function SuggestedPrompts({ disabled, onSelect }: Props) {
  return (
    <div className="mx-auto mt-3 flex max-w-2xl flex-wrap items-center justify-center gap-2">
      {PROMPT_META.map((p, i) => (
        <motion.button
          key={p.text}
          type="button"
          disabled={disabled}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 + i * 0.06, duration: 0.25 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => onSelect(p.text)}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border-strong px-3.5 py-2 text-xs font-medium text-muted-foreground transition-all duration-150 hover:border-primary hover:bg-primary-bright/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <p.icon size={13} />
          {p.label}
        </motion.button>
      ))}
    </div>
  )
}
