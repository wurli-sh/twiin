import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ArrowRight, Sparkles } from 'lucide-react'

export function HeroSection() {
  return (
    <section className="relative -mx-4 sm:-mx-6 flex min-h-[88vh] flex-col justify-center overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-primary/25 blur-[100px]" />
        <div className="absolute bottom-0 right-0 h-[280px] w-[420px] rounded-full bg-accent/15 blur-[90px]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-bg to-transparent" />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-10 py-20 text-center">
        <motion.div
          className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <Sparkles size={14} />
          Somnia Agentathon · ERC-6551 agents
        </motion.div>

        <div className="flex max-w-[920px] flex-col items-center gap-5">
          <motion.h1
            className="text-balance text-5xl font-bold tracking-[-0.04em] text-text sm:text-6xl md:text-7xl md:leading-[1.05]"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.23, 1, 0.32, 1] }}
          >
            Mint a named AI agent.
            <span className="block bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
              It hires, pays, and publishes on-chain.
            </span>
          </motion.h1>
          <motion.p
            className="max-w-[640px] text-pretty text-lg leading-relaxed text-text-muted sm:text-xl"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.1 }}
          >
            Every Twiin is an NFT with its own wallet — it autonomously picks specialist
            sub-agents, pays them from policy-guarded escrow, and publishes oracle feeds
            any contract can read.
          </motion.p>
        </div>

        <motion.div
          className="flex flex-wrap items-center justify-center gap-3"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.18 }}
        >
          <Link to="/console">
            <motion.button
              type="button"
              className="inline-flex h-12 cursor-pointer items-center gap-2 rounded-xl bg-primary px-8 text-sm font-bold text-secondary shadow-lg shadow-primary/20"
              whileHover={{ scale: 1.03, y: -1 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 15 }}
            >
              Open Console
              <ArrowRight size={16} />
            </motion.button>
          </Link>
          <Link to="/agents">
            <motion.button
              type="button"
              className="inline-flex h-12 cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface px-6 text-sm font-semibold text-text hover:bg-surface-alt transition-colors"
              whileHover={{ scale: 1.03, y: -1 }}
              whileTap={{ scale: 0.97 }}
            >
              Mint Agent
            </motion.button>
          </Link>
        </motion.div>
      </div>
    </section>
  )
}
