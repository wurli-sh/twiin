import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { fadeInUp, staggerContainer, scrollViewport } from '@/lib/animations'

export function CallToAction() {
  return (
    <section className="py-20">
      <motion.div
        className="mx-auto max-w-4xl text-center"
        initial="hidden"
        whileInView="visible"
        viewport={scrollViewport}
        variants={staggerContainer}
      >
        <motion.h2
          className="text-balance text-4xl font-bold tracking-tight text-text md:text-5xl"
          variants={fadeInUp}
        >
          Ship an autonomous agent on{' '}
          <span className="text-primary">Somnia</span>
        </motion.h2>

        <motion.p
          className="mx-auto mt-6 max-w-xl text-pretty text-lg text-text-muted"
          variants={fadeInUp}
        >
          Mint a named Twiin, fund its wallet, and let it hire specialists from an open
          marketplace — all triggered by on-chain events.
        </motion.p>

        <motion.div className="mt-10 flex flex-wrap items-center justify-center gap-3" variants={fadeInUp}>
          <Link to="/agents">
            <motion.button
              type="button"
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-8 py-3.5 text-base font-bold text-secondary"
              whileHover={{ scale: 1.02, y: -1 }}
              whileTap={{ scale: 0.98 }}
            >
              Mint Agent
              <ArrowRight size={16} />
            </motion.button>
          </Link>
          <Link to="/marketplace">
            <motion.button
              type="button"
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface px-6 py-3.5 text-base font-semibold text-text hover:bg-surface-alt transition-colors"
              whileHover={{ scale: 1.02, y: -1 }}
              whileTap={{ scale: 0.98 }}
            >
              Browse Marketplace
            </motion.button>
          </Link>
        </motion.div>
      </motion.div>
    </section>
  )
}
