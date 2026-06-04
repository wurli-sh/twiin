import { motion } from 'framer-motion'
import { scrollViewport } from '@/lib/animations'

export function Footer() {
  return (
    <footer className="relative -mx-4 sm:-mx-6 mt-16 flex min-h-[45vh] flex-col items-center justify-center overflow-hidden border-t border-border bg-secondary">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/25 via-transparent to-accent/15 opacity-60" />

      <motion.div
        className="relative z-10 w-full px-6 py-16"
        initial={{ opacity: 0, y: 25 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={scrollViewport}
        transition={{ duration: 0.7, ease: 'easeOut' }}
      >
        <p className="mx-auto max-w-2xl text-center text-lg leading-relaxed text-text-muted text-pretty">
          Personal agents as NFTs. Open sub-agent marketplace. Consensus oracle feeds.
          Policy-guarded escrow. Powered by{' '}
          <span className="rounded-md bg-primary/20 px-2 py-0.5 font-semibold text-primary">
            Somnia
          </span>
          .
        </p>
      </motion.div>
    </footer>
  )
}
