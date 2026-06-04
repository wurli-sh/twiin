import { motion } from 'framer-motion'
import { cn } from '@/lib/cn'

interface TabItem {
  label: string
  key: string
}

interface TabsProps {
  items: TabItem[]
  active: string
  onChange: (key: string) => void
  className?: string
  trailing?: React.ReactNode
}

export function Tabs({ items, active, onChange, className, trailing }: TabsProps) {
  return (
    <div className={cn('flex items-center gap-1 border-b border-border/40 pb-px', className)}>
      {items.map((item) => (
        <button
          key={item.key}
          onClick={() => onChange(item.key)}
          className={cn(
            'relative px-4 py-2.5 text-xs font-semibold uppercase tracking-wider rounded-md cursor-pointer transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            active === item.key
              ? 'text-primary'
              : 'text-text-muted hover:text-text'
          )}
        >
          {active === item.key && (
            <motion.div
              layoutId="activeTab"
              className="absolute inset-0 rounded-md bg-surface-alt"
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            />
          )}
          <span className="relative z-10">{item.label}</span>
        </button>
      ))}
      {trailing && <div className="ml-auto">{trailing}</div>}
    </div>
  )
}
