import { ExecutionPanel, type ExecutionPanelProps } from './ExecutionPanel'
import { ExecutionPanelOverlay } from './ExecutionPanelOverlay'
import { cn } from '@/lib/cn'

type Props = ExecutionPanelProps & {
  open: boolean
  mobileOpen: boolean
  onMobileClose: () => void
}

export function ExecutionSidebar({
  open,
  mobileOpen,
  onMobileClose,
  ...panelProps
}: Props) {
  return (
    <>
      <aside
        className={cn(
          'hidden h-full min-h-0 shrink-0 flex-col border-l border-border/80 bg-background transition-[width] duration-200 ease-out lg:flex',
          open ? 'w-72' : 'w-0 overflow-hidden border-l-0',
        )}
        aria-hidden={!open}
      >
        {open && (
          <div className="flex h-full min-h-0 w-72 flex-col overflow-hidden">
            <ExecutionPanel {...panelProps} />
          </div>
        )}
      </aside>

      <ExecutionPanelOverlay
        open={mobileOpen}
        onClose={onMobileClose}
        {...panelProps}
      />
    </>
  )
}
