import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Cpu, Sparkles, Shield } from 'lucide-react'
import { TiltCard } from '@/components/spell/tilt-card'
import { HighlightedText } from '@/components/spell/highlighted-text'
import { fadeInUp, fadeInLeft, fadeInRight, staggerContainer, scrollViewport } from '@/lib/animations'

const dotGrid = {
  backgroundImage: 'radial-gradient(circle, rgba(159, 232, 112, 0.4) 1px, transparent 1px)',
  backgroundSize: '20px 20px',
}

const dotGridLight = {
  backgroundImage: 'radial-gradient(circle, rgba(22, 51, 0, 0.3) 1px, transparent 1px)',
  backgroundSize: '16px 16px',
}

export function GatewayBento() {
  return (
    <section className="py-24">
      <motion.div
        className="mx-auto max-w-4xl px-6"
        initial="hidden"
        whileInView="visible"
        viewport={scrollViewport}
        variants={staggerContainer}
      >
        <motion.h2
          className="text-balance text-center text-4xl font-bold tracking-tight text-foreground md:text-5xl"
          variants={fadeInUp}
        >
          Own the AI Agent
        </motion.h2>
        <motion.p className="mt-4 text-center text-muted-foreground" variants={fadeInUp}>
          Plans with Claude, hires sub-agents, reaches{' '}
          <HighlightedText variant="lime" from="bottom" inView>
            validator consensus
          </HighlightedText>
          ,{' '}
            and publishes on-chain
          .
        </motion.p>

        <motion.div className="mt-16 grid gap-6 md:grid-cols-2" variants={staggerContainer}>
          <motion.div
            className="relative row-span-2 overflow-hidden bg-charcoal p-8 text-white"
            variants={fadeInLeft}
          >
            <div className="absolute inset-0 opacity-20" style={dotGrid} />
            <div className="relative z-10">
              <h3 className="text-xl font-bold">Twiin Console</h3>
              <p className="mt-3 max-w-xs text-sm leading-relaxed text-white/70 text-pretty">
                Describe a goal, review Claude&apos;s plan,{' '}
                  approve once, and watch keepers execute every step on Somnia testnet.
              </p>
              <Link
                to="/console"
                className="mt-6 inline-block border border-primary-bright/40 bg-primary-bright/10 px-4 py-2 text-sm font-semibold text-primary-bright hover:bg-primary-bright/20"
              >
                Try the console →
              </Link>
            </div>
            <div className="relative mt-8 flex items-center justify-center">
              <div className="absolute left-1/2 top-1/2 size-48 -translate-x-1/2 -translate-y-1/2 bg-primary-bright/20 blur-3xl" />
              <Cpu size={120} className="relative z-10 text-primary-bright/80" strokeWidth={1} />
            </div>
          </motion.div>

          <TiltCard tiltLimit={12} scale={1.02} className="h-full">
            <motion.div
              className="relative h-full overflow-hidden border border-border bg-primary-bright/5 p-6"
              variants={fadeInRight}
            >
              <div className="absolute inset-0 opacity-10" style={dotGridLight} />
              <div className="pointer-events-none absolute inset-0 bg-linear-to-bl from-primary-bright/15 via-transparent to-transparent" />
              <div className="relative z-10">
                <Sparkles className="mb-3 text-primary" size={24} />
                <h3 className="text-xl font-bold text-foreground">Claude Planning</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Haiku drafts step-by-step plans with{' '}
                    budget estimates. You approve before a single wei moves.
                </p>
              </div>
            </motion.div>
          </TiltCard>

          <motion.div
            className="relative overflow-hidden border border-border bg-primary-bright/5 p-6"
            variants={fadeInRight}
          >
            <div className="absolute inset-0 opacity-10" style={dotGridLight} />
            <div className="relative z-10">
              <Shield className="mb-3 text-primary" size={24} />
              <h3 className="text-xl font-bold text-foreground">Policy-Guarded Escrow</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Per-task caps, daily limits, and{' '}
                  kill switches keep your 6551 wallet safe while sub-agents get paid.
              </p>
            </div>
          </motion.div>
        </motion.div>
      </motion.div>
    </section>
  )
}
