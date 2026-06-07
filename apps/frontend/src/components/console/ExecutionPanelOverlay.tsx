import { AnimatePresence, motion } from 'framer-motion'
import { ExecutionPanel, type ExecutionPanelProps } from './ExecutionPanel'
import { cn } from '@/lib/cn'

type Props = ExecutionPanelProps & {
  open: boolean
  onClose: () => void
}

export function ExecutionPanelOverlay({ open, onClose, ...panelProps }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Close execution panel"
            className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-[1px] lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className={cn(
              'fixed inset-y-0 right-0 z-50 flex w-[min(100%,20rem)] flex-col border-l border-border bg-background shadow-lg lg:hidden',
            )}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          >
            <div className="min-h-0 flex-1 overflow-hidden">
              <ExecutionPanel {...panelProps} onClose={onClose} />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
