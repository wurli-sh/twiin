import { motion } from 'framer-motion'
import { Layers } from 'lucide-react'
import { TiltCard } from '@/components/spell/tilt-card'
import { HighlightedText } from '@/components/spell/highlighted-text'
import { fadeInUp, staggerContainer, scrollViewport } from '@/lib/animations'

const PERKS = [
  {
    label: 'Preload STT',
    detail: (
      <>
        Fund your agent wallet once. Balance lives in the{' '}
          ERC-6551 token-bound account
        .
      </>
    ),
  },
  {
    label: 'Pay sub-agents',
    detail: (
      <>
        Escrow releases STT to marketplace sub-agents as each step{' '}
          completes on-chain
        .
      </>
    ),
  },
  {
    label: 'Policy caps',
    detail: (
      <>
        Daily spend, per-task max, and kill switch —{' '}
          enforced before any payment leaves
        .
      </>
    ),
  },
] as const

function AgentWalletCard() {
  return (
    <TiltCard
      tiltLimit={8}
      scale={1.015}
      perspective={1400}
      effect="evade"
      spotlight
      className="mx-auto w-full max-w-[420px]"
    >
      <div className="relative aspect-[1.586/1] w-full overflow-hidden border border-white/8 bg-linear-to-br from-[#161616] via-[#101010] to-[#090909] p-8 text-white shadow-elev">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            backgroundImage:
              'linear-gradient(145deg, rgba(255,255,255,0.06) 0%, transparent 38%, rgba(0,0,0,0.24) 100%)',
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-white/[0.03] via-transparent to-black/20" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />

        <div className="relative z-10 flex h-full flex-col justify-between">
          <div className="flex items-start justify-between">
            <div className="space-y-3">
              <Layers size={18} className="text-white/75" strokeWidth={1.5} />
              <p className="text-lg font-bold italic tracking-tight text-primary-bright">Twiin</p>
            </div>
            <span className="text-sm font-bold italic tracking-tight text-white/90">STT</span>
          </div>

          <div className="flex items-end justify-between gap-6">
            <div>
              <p className="text-[11px] text-white/45">research-bot</p>
              <p className="mt-2 text-base font-medium tracking-[0.18em] text-white md:text-lg">
                6551&nbsp;2400&nbsp;STT&nbsp;0420
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[11px] text-white/45">Balance</p>
              <p className="mt-2 text-lg font-medium tabular-nums text-white">2.40</p>
            </div>
          </div>
        </div>
      </div>
    </TiltCard>
  )
}

export function Ecosystem() {
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
          Prepaid agent wallets
        </motion.h2>
        <motion.p
          className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground text-pretty"
          variants={fadeInUp}
        >
          Every Twiin agent ships with its own STT balance — like a{' '}
          <HighlightedText variant="lime" from="bottom" inView>
            prepaid card
          </HighlightedText>
          . Load funds, set spend limits, and let your agent{' '}
          <HighlightedText variant="mint" from="left" inView delay={0.06}>
            pay sub-agents autonomously
          </HighlightedText>{' '}
          as tasks execute.
        </motion.p>

        <motion.div className="mt-16" variants={fadeInUp}>
          <AgentWalletCard />
        </motion.div>

        <motion.ul
          className="mt-12 grid gap-4 border border-border bg-card p-6 md:grid-cols-3"
          variants={staggerContainer}
        >
          {PERKS.map((perk) => (
            <motion.li key={perk.label} variants={fadeInUp}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {perk.label}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">
                {perk.detail}
              </p>
            </motion.li>
          ))}
        </motion.ul>
      </motion.div>
    </section>
  )
}
