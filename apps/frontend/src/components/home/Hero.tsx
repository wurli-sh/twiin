import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { TextLoop } from '@/components/ui/TextLoop'
import { BlurReveal } from '@/components/spell/blur-reveal'
import { HighlightedText } from '@/components/spell/highlighted-text'
import { HeroConsolePreview } from '@/components/home/HeroConsolePreview'
import {
  fadeInLeft,
  fadeInRight,
  staggerContainer,
  buttonHover,
  buttonTap,
} from '@/lib/animations'

const TRUST_CHIPS = ['Somnia testnet', 'Claude planning', 'ERC-6551 wallet'] as const

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-[linear-gradient(180deg,#fffffe_0%,#fdfff9_20%,#fbfff6_46%,#fefff9_74%,#ffffff_100%)] pb-28 pt-16">
      <div className="relative z-10 mx-auto grid w-full max-w-5xl items-center gap-10 px-4 sm:px-6 md:grid-cols-2 md:gap-8">
        <motion.div
          className="text-left"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          <motion.div
            className="mb-6 inline-flex items-center gap-2.5 border border-primary/20 bg-primary-bright/30 px-3.5 py-2 text-sm font-medium text-primary"
            variants={fadeInLeft}
          >
            <div className="size-3.5 shrink-0 bg-primary-bright shadow-lime-pill" />
            Twiin on Somnia
          </motion.div>

          <motion.div variants={fadeInLeft}>
            <h1
              aria-label="Own the AI agent. Plans. Hires. Verifies. Publishes."
              className="text-balance text-4xl font-bold leading-[1.1] tracking-tight text-foreground sm:text-5xl lg:text-6xl xl:text-7xl"
            >
              <BlurReveal as="span" className="block" speedReveal={1.1}>
                Own the AI agent.
              </BlurReveal>
              <span className="mt-1 block text-primary">
                <TextLoop interval={2.5} className="justify-items-start">
                  {['Plans.', 'Hires.', 'Verifies.', 'Publishes.']}
                </TextLoop>
              </span>
            </h1>
          </motion.div>

          <motion.p
            className="mt-6 max-w-lg text-pretty text-base text-muted-foreground sm:text-lg"
            variants={fadeInLeft}
          >
            Own the AI agent that plans with Claude, hires sub-agents, and reaches
            consensus —{' '}
            <HighlightedText from="bottom" variant="ink">
              every step is verified on-chain
            </HighlightedText>
            .
          </motion.p>

          <motion.div
            className="mt-8 flex flex-wrap items-center gap-3 sm:gap-4"
            variants={fadeInLeft}
          >
            <Link to="/console">
              <motion.div whileHover={buttonHover} whileTap={buttonTap}>
                <Button size="lg">Open Console</Button>
              </motion.div>
            </Link>
            <Link to="/agents">
              <motion.div whileHover={buttonHover} whileTap={buttonTap}>
                <Button size="lg" variant="outline">
                  Mint Agent
                </Button>
              </motion.div>
            </Link>
          </motion.div>

          <motion.ul
            className="mt-8 flex flex-wrap gap-x-4 gap-y-2"
            variants={fadeInLeft}
          >
            {TRUST_CHIPS.map((chip) => (
              <li
                key={chip}
                className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
              >
                {chip}
              </li>
            ))}
          </motion.ul>
        </motion.div>

        <motion.div
          className="w-full max-w-md justify-self-center md:max-w-none md:justify-self-stretch"
          variants={fadeInRight}
          initial="hidden"
          animate="visible"
        >
          <div className="rounded-xl shadow-card ring-1 ring-border/60">
            <HeroConsolePreview />
          </div>
        </motion.div>
      </div>
    </section>
  )
}
