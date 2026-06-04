import { useState } from 'react'
import {
  CircleCheckBig,
  Cpu,
  Network,
  ShieldCheck,
  Sparkles,
  Wallet,
  ArrowLeftRight,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/cn'
import { fadeInUp, staggerContainer, scrollViewport } from '@/lib/animations'

const steps = [
  {
    id: 1,
    label: 'Mint Agent',
    sub: 'Identity',
    icon: Sparkles,
    description:
      'Deploy a Twiin in one tx — NFT minted, ERC-6551 wallet funded, name@twiin claimed, policy seeded.',
    highlights: [
      { label: 'Cost', value: '5 STT', icon: Wallet },
      { label: 'Namespace', value: 'neo@twiin', icon: Cpu },
    ],
    details: [
      'Agent identity is the ERC-721 token ID',
      'Persistent funds live in the 6551 account',
    ],
  },
  {
    id: 2,
    label: 'Run Task',
    sub: 'Orchestrate',
    icon: Network,
    description:
      'Describe a goal — Claude plans steps, native and external sub-agents execute, Haiku rates external results before payment.',
    highlights: [
      { label: 'Lanes', value: 'Native', value2: 'External', icon: ArrowLeftRight },
      { label: 'Auth', value: '6551 execute', icon: ShieldCheck },
    ],
    details: [
      'Budget locked once at createTask',
      'Unused STT sweeps back to the agent wallet',
    ],
  },
  {
    id: 3,
    label: 'Oracle Feed',
    sub: 'Publish',
    icon: ShieldCheck,
    description:
      'Complete a task to publish consensus-verified feeds with TTL, staleness checks, and chain-side refresh via Reactivity.',
    highlights: [
      { label: 'Consumers', value: 'Any contract', icon: Cpu },
      { label: 'Refresh', value: 'On-chain', icon: Network },
    ],
    details: [
      'subscribePull pre-authorises refresh pulls',
      'SSE is advisory — chain is source of truth',
    ],
  },
]

export function HowItWorks() {
  const [selectedStep, setSelectedStep] = useState(1)
  const step = steps.find((s) => s.id === selectedStep)!
  const Icon = step.icon

  return (
    <section className="py-20">
      <motion.div
        className="mx-auto max-w-4xl"
        initial="hidden"
        whileInView="visible"
        viewport={scrollViewport}
        variants={staggerContainer}
      >
        <motion.h2
          variants={fadeInUp}
          className="text-balance text-center text-4xl font-bold tracking-tight text-text md:text-5xl"
        >
          Three steps. One autonomous agent.
        </motion.h2>
        <motion.p variants={fadeInUp} className="mt-4 text-center text-text-muted">
          Identity on-chain, execution through an open marketplace, feeds any protocol can consume.
        </motion.p>

        <motion.div
          variants={fadeInUp}
          className="mt-14 grid overflow-hidden rounded-xl border border-border bg-surface/40 grid-cols-1 md:grid-cols-[220px_1fr]"
        >
          <div className="border-b md:border-b-0 md:border-r border-border bg-primary/5">
            {steps.map((s) => {
              const StepIcon = s.icon
              return (
                <motion.button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedStep(s.id)}
                  whileHover={{ x: 4 }}
                  whileTap={{ scale: 0.98 }}
                  className={cn(
                    'flex w-full cursor-pointer items-center justify-between px-5 py-4 text-left transition-colors',
                    selectedStep === s.id
                      ? 'border-l-2 border-l-primary bg-primary/10'
                      : 'border-l-2 border-l-transparent hover:bg-primary/5',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'flex size-7 items-center justify-center rounded-md',
                        selectedStep === s.id ? 'bg-primary' : 'bg-primary/20',
                      )}
                    >
                      <StepIcon
                        size={13}
                        className={cn(
                          selectedStep === s.id ? 'text-secondary' : 'text-primary',
                        )}
                      />
                    </div>
                    <div>
                      <p
                        className={cn(
                          'text-sm font-semibold',
                          selectedStep === s.id ? 'text-text' : 'text-text-muted',
                        )}
                      >
                        {s.label}
                      </p>
                      <p className="text-xs text-text-faint">{s.sub}</p>
                    </div>
                  </div>
                </motion.button>
              )
            })}
          </div>

          <div className="min-h-[340px] overflow-y-auto p-6 sm:p-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={selectedStep}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.25 }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-bold text-text">{step.label}</h3>
                    <p className="mt-1.5 max-w-md text-sm leading-relaxed text-text-muted">
                      {step.description}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary/15 border border-primary/25 px-4 py-2.5">
                    <Icon size={14} className="text-primary" />
                    <p className="text-sm font-bold text-text">Step {step.id}</p>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {step.highlights.map((h) => {
                    const HIcon = h.icon
                    return (
                      <div
                        key={h.label}
                        className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4"
                      >
                        <div className="flex size-10 items-center justify-center rounded-md bg-primary/15">
                          <HIcon size={18} className="text-primary" />
                        </div>
                        <div>
                          <p className="text-xs font-medium text-text-faint">{h.label}</p>
                          <p className="text-lg font-bold text-text flex items-center gap-1.5">
                            {h.value}
                            {'value2' in h && (
                              <>
                                <ArrowLeftRight size={14} className="text-text-faint" />
                                {h.value2}
                              </>
                            )}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <ul className="mt-6 flex flex-col gap-2">
                  {step.details.map((detail) => (
                    <li
                      key={detail}
                      className="flex items-center gap-2.5 text-sm text-text-muted"
                    >
                      <CircleCheckBig size={14} className="shrink-0 text-primary" />
                      {detail}
                    </li>
                  ))}
                </ul>
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
    </section>
  )
}
