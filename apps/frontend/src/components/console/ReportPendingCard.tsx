import { motion } from 'framer-motion'
import { FileText } from 'lucide-react'
import { TextShimmer } from '@/components/ui/TextShimmer'
import { ThinkingSpinner } from '@/components/ui/ThinkingSpinner'
import { consolePageTheme } from '@/lib/execution-mode-theme'
import { useRotatingPhrase } from '@/hooks/useRotatingPhrase'
import { cn } from '@/lib/cn'

const REPORT_WAIT_PHRASES = [
  'Tinkering with oracle results…',
  'Assembling your report…',
  'Decoding on-chain step data…',
  'Polishing the snapshot…',
  'Waiting for reporter-bot…',
  'Cross-checking metrics…',
]

type Props = {
  taskId?: string
}

export function ReportPendingCard({ taskId }: Props) {
  const modeTheme = consolePageTheme()
  const phrase = useRotatingPhrase(REPORT_WAIT_PHRASES, 2400)

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn(
        'max-w-[92%] overflow-hidden rounded-lg border shadow-card',
        modeTheme.agentCard,
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2.5 border-b px-3 py-2.5',
          modeTheme.resultHeader,
        )}
      >
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md',
            modeTheme.resultIcon,
          )}
        >
          <FileText size={13} strokeWidth={2.25} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn('text-[10px] font-medium uppercase tracking-wide', modeTheme.text)}>
            Agent report
          </p>
          <p className="text-sm font-semibold text-foreground">Preparing report</p>
          {taskId && (
            <p className="mt-0.5 text-[10px] text-muted-foreground">Task #{taskId}</p>
          )}
        </div>
        <ThinkingSpinner className={cn('size-4 shrink-0', modeTheme.statusSpinner)} />
      </div>

      <div className="space-y-3 px-3 py-3">
        <TextShimmer className={cn('text-sm', modeTheme.text)} active>
          {phrase}
        </TextShimmer>

        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="h-2.5 rounded-sm bg-muted/80"
              animate={{ opacity: [0.35, 0.75, 0.35] }}
              transition={{
                duration: 1.4,
                repeat: Infinity,
                delay: i * 0.18,
                ease: 'easeInOut',
              }}
              style={{ width: `${88 - i * 14}%` }}
            />
          ))}
        </div>

        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Steps finished on-chain — pulling the final report into view.
        </p>
      </div>
    </motion.div>
  )
}
