import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useNetworkGuard } from '@/hooks/useNetworkGuard'

export function NetworkBanner() {
  const { wrongNetwork, isSwitching, switchToSomnia, targetName } = useNetworkGuard()

  return (
    <AnimatePresence>
      {wrongNetwork && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="flex justify-center px-4"
        >
          <div className="mt-3 flex w-full max-w-5xl flex-col items-center justify-between gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-2.5 text-xs sm:flex-row">
            <span className="flex items-center gap-2 font-semibold text-warning">
              <AlertTriangle size={14} />
              Wrong network — Twiin runs on {targetName}.
            </span>
            <button
              type="button"
              onClick={() => switchToSomnia()}
              disabled={isSwitching}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-warning px-3 py-1.5 text-[11px] font-bold text-secondary hover:bg-warning/90 disabled:opacity-60"
            >
              {isSwitching ? <Loader2 size={12} className="animate-spin" /> : null}
              {isSwitching ? 'Switching…' : 'Switch network'}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
