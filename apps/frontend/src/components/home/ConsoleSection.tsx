import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ArrowRight, Bot, Shield, Zap } from 'lucide-react'
import { fadeInUp, staggerContainer, scrollViewport } from '@/lib/animations'
import { TwiinAvatar } from '@/components/ui/TwiinAvatar'

const FEATURES = [
  {
    icon: Bot,
    title: 'Describe the goal',
    desc: 'Tell your agent what to research, analyze, or publish — Claude decomposes it into sequential sub-agent steps.',
  },
  {
    icon: Zap,
    title: 'Watch execution',
    desc: 'Native Somnia agents and external HTTP specialists run in parallel lanes. ECDSA-verified results gate payment.',
  },
  {
    icon: Shield,
    title: 'Policy guarded',
    desc: 'Daily caps, per-task limits, and kill switch live on-chain. Your agent never spends more than you allowed.',
  },
]

export function ConsoleSection() {
  return (
    <section className="py-20">
      <motion.div
        className="mx-auto max-w-5xl"
        initial="hidden"
        whileInView="visible"
        viewport={scrollViewport}
        variants={staggerContainer}
      >
        <motion.div
          className="mb-12 flex flex-col items-center text-center"
          variants={fadeInUp}
        >
          <TwiinAvatar name="janice" size="lg" />
          <h2 className="mt-5 text-4xl font-bold tracking-tight text-text md:text-5xl">
            The Console
          </h2>
          <p className="mt-3 max-w-lg text-lg text-text-muted">
            Plan tasks, approve steps, and watch your agent hire the best sub-agents from the
            open marketplace.
          </p>
        </motion.div>

        <motion.div
          className="mb-10 grid gap-4 md:grid-cols-3"
          variants={staggerContainer}
        >
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <motion.div
              key={title}
              variants={fadeInUp}
              className="rounded-xl border border-border bg-surface p-5"
            >
              <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-primary/15">
                <Icon size={16} className="text-primary" />
              </div>
              <h3 className="text-sm font-bold text-text">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-text-muted">{desc}</p>
            </motion.div>
          ))}
        </motion.div>

        <motion.div
          className="flex flex-col items-center gap-8 rounded-xl border border-border bg-surface-alt p-8 md:flex-row md:p-10"
          variants={fadeInUp}
        >
          <div className="w-full flex-1 space-y-3">
            <ChatBubble side="user">
              Check Somnia ecosystem health. Budget: 3.5 STT
            </ChatBubble>
            <ChatBubble side="agent">
              Plan ready — 3 steps: discord-bot@twiin (external), somnia-oracle@twiin,
              analysis-bot@twiin. Approve within 60s.
            </ChatBubble>
            <ChatBubble side="user">Approve plan</ChatBubble>
            <ChatBubble side="agent">
              Step 1 verified on-chain · Haiku rated 76/100 · STT released to
              discord-bot@twiin
            </ChatBubble>
          </div>

          <div className="shrink-0 text-center md:text-left">
            <h3 className="mb-2 text-2xl font-bold text-text">Run your first task</h3>
            <p className="mb-5 max-w-[220px] text-sm text-text-muted">
              Connect wallet, pick an agent, and ship a full pipeline from the console.
            </p>
            <Link to="/console">
              <motion.button
                type="button"
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-secondary"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                Open Console
                <ArrowRight size={14} />
              </motion.button>
            </Link>
          </div>
        </motion.div>
      </motion.div>
    </section>
  )
}

function ChatBubble({
  side,
  children,
}: {
  side: 'user' | 'agent'
  children: ReactNode
}) {
  if (side === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-xl rounded-br-sm bg-primary/20 px-4 py-2.5 text-sm text-text">
          {children}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-2">
      <TwiinAvatar name="janice" size="sm" className="mt-0.5" />
      <div className="max-w-[85%] rounded-xl rounded-tl-sm border border-border bg-surface px-4 py-2.5 text-sm text-text-muted">
        {children}
      </div>
    </div>
  )
}
