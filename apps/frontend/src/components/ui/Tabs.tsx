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
  layoutId?: string
}

export function Tabs({
  items,
  active,
  onChange,
  className,
  trailing,
  layoutId = 'tabIndicator',
}: TabsProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-0.5 border-b-2 border-border bg-muted/30 px-1 pt-1',
        className,
      )}
    >
      {items.map((item) => {
        const isActive = active === item.key
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            className={cn(
              'relative cursor-pointer px-4 py-2.5 text-xs font-semibold uppercase tracking-wider outline-none transition-colors duration-200 focus-visible:shadow-glow',
              isActive
                ? 'text-primary'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {isActive && (
              <>
                <motion.div
                  layoutId={layoutId}
                  className="absolute inset-0 border border-primary/20 bg-primary-bright/25 shadow-soft"
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                />
                <motion.div
                  layoutId={`${layoutId}-bar`}
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-primary-bright"
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                />
              </>
            )}
            <span className="relative z-10">{item.label}</span>
          </button>
        )
      })}
      {trailing && <div className="ml-auto pr-2">{trailing}</div>}
    </div>
  )
}
