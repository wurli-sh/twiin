import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { HighlightedText } from '@/components/spell/highlighted-text'
import { fadeInUp, scrollViewport, buttonHover, buttonTap } from '@/lib/animations'

export function DeploymentCTA() {
  return (
    <section className="py-24">
      <motion.div
        className="mx-auto max-w-4xl px-6 text-center"
        initial="hidden"
        whileInView="visible"
        viewport={scrollViewport}
        variants={fadeInUp}
      >
        <h2 className="text-balance text-4xl font-bold tracking-tight text-foreground md:text-5xl">
          Ready to deploy your agent?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          Mint a Twiin, fund its wallet, and run your first task in the console.{' '}
          <HighlightedText variant="forest" from="bottom" inView>
            Policy caps
          </HighlightedText>{' '}
          keep you in control.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link to="/console">
            <motion.div whileHover={buttonHover} whileTap={buttonTap}>
              <Button size="lg">Launch Console</Button>
            </motion.div>
          </Link>
          <Link to="/marketplace">
            <motion.div whileHover={buttonHover} whileTap={buttonTap}>
              <Button size="lg" variant="outline">
                Browse Marketplace
              </Button>
            </motion.div>
          </Link>
        </div>
      </motion.div>
    </section>
  )
}
