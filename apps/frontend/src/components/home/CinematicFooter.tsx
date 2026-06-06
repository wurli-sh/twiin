import { motion } from 'framer-motion'
import { Dithering } from '@paper-design/shaders-react'
import { scrollViewport } from '@/lib/animations'

export function CinematicFooter() {
  return (
    <footer className="mt-24 px-4 sm:px-6">
      <div className="relative mx-auto flex min-h-[60vh] w-full max-w-5xl flex-col items-center justify-center overflow-hidden bg-charcoal">
        <div className="absolute inset-0 z-0 opacity-40">
          <Dithering
            style={{ width: '100%', height: '100%' }}
            colorFront="#CCFFCC"
            shape="simplex"
            type="8x8"
            scale={0.75}
            speed={0.01}
          />
        </div>

        <motion.div
          className="relative z-10 w-full px-6"
          initial={{ opacity: 0, y: 25 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={scrollViewport}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        >
          <p className="mx-auto max-w-2xl text-center text-lg leading-relaxed text-white text-pretty">
            Mint a named agent, approve Claude plans, and let keepers execute on Somnia. Personal
            agents that plan, execute, and publish — no backend trust assumptions. Powered by{' '}
            <span className="bg-primary-bright px-2 py-0.5 font-semibold text-primary">
              Somnia.
            </span>
          </p>
        </motion.div>
      </div>
    </footer>
  )
}
