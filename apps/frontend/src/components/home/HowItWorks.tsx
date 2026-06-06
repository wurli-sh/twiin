import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AnimatedCheckbox } from '@/components/spell/animated-checkbox'
import { HighlightedText } from '@/components/spell/highlighted-text'
import { fadeInUp, scrollViewport } from '@/lib/animations'

const STEPS = [
  {
    id: 'mint',
    title: 'Mint Agent',
    tasks: ['Connect wallet', 'Choose agent name', 'Fund TBA wallet', 'Set policy caps'],
  },
  {
    id: 'plan',
    title: 'Plan Task',
    tasks: ['Enter goal', 'Set STT budget', 'Review plan steps', 'Check policy fit'],
  },
  {
    id: 'execute',
    title: 'Execute',
    tasks: ['Approve on-chain', 'Watch live timeline', 'Sub-agents execute', 'Feeds published'],
  },
] as const

export function HowItWorks() {
  const [active, setActive] = useState<(typeof STEPS)[number]['id']>('mint')
  const step = STEPS.find((s) => s.id === active) ?? STEPS[0]

  return (
    <section className="py-24">
      <motion.div
        className="mx-auto max-w-4xl px-6"
        initial="hidden"
        whileInView="visible"
        viewport={scrollViewport}
        variants={fadeInUp}
      >
        <h2 className="text-balance text-center text-4xl font-bold tracking-tight text-foreground md:text-5xl">
          How Twiin Works
        </h2>
        <p className="mt-4 text-center text-muted-foreground">
          Three steps from wallet to autonomous execution.
        </p>

        <div className="mt-16 grid overflow-hidden border border-border md:grid-cols-[220px_1fr]">
          <div className="divide-y divide-border border-b border-border md:border-b-0 md:border-r">
            {STEPS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActive(s.id)}
                className={`w-full px-5 py-4 text-left text-sm font-semibold transition-colors ${
                  active === s.id
                    ? 'border-l-2 border-l-primary bg-secondary/90 text-primary'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {s.title}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={step.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="p-8"
            >
              <h3 className="text-2xl font-bold text-foreground">{step.title}</h3>
              <p className="mt-3 max-w-lg text-muted-foreground">
                {step.id === 'mint' && (
                  <>
                    Deploy a named Twiin NFT with a{' '}
                    <HighlightedText variant="forest" from="left" inView>
                      6551 token-bound account
                    </HighlightedText>
                    . Set daily caps, per-task limits, and a kill switch.
                  </>
                )}
                {step.id === 'plan' && (
                  <>
                    Describe your goal in the console.{' '}
                    <HighlightedText variant="sky" from="bottom" inView>
                      Claude drafts a multi-step plan
                    </HighlightedText>{' '}
                    with sub-agent assignments and budget estimate.
                  </>
                )}
                {step.id === 'execute' && (
                  <>
                    Approve the plan on-chain. Keepers execute each step, pay sub-agents from
                    escrow, and{' '}
                    <HighlightedText variant="ink" from="right" inView>
                      publish oracle feeds
                    </HighlightedText>
                    .
                  </>
                )}
              </p>
              <div className="mt-8 space-y-3">
                {step.tasks.map((task, i) => (
                  <AnimatedCheckbox
                    key={task}
                    title={task}
                    defaultChecked={i === 0}
                    className="text-foreground"
                  />
                ))}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </section>
  )
}
