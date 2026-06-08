import { useRef, useState } from 'react'
import { ChevronDown, Wallet } from 'lucide-react'
import { formatAgentLabel } from '@/lib/agent-name'
import type { TwiinAgentInfo } from '@/hooks/useTwiinAgents'
import { DropdownPanel } from '@/components/ui/DropdownPanel'
import { cn } from '@/lib/cn'

type AgentSelectorProps = {
  agents: TwiinAgentInfo[]
  selectedId: string | null
  onSelect: (id: string) => void
  disabled?: boolean
  loading?: boolean
  compact?: boolean
}

export function AgentSelector({
  agents,
  selectedId,
  onSelect,
  disabled,
  loading,
  compact,
}: AgentSelectorProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const selected = agents.find((a) => a.id.toString() === selectedId) ?? null

  const footprint = cn(
    'flex min-h-[36px] items-center rounded-lg border border-border-strong',
    compact ? 'min-w-[180px]' : 'min-w-[220px]',
  )

  if (loading) {
    return (
      <div className={cn(footprint, 'animate-pulse border-border bg-muted px-2.5')} />
    )
  }

  if (agents.length === 0) {
    return (
      <div
        className={cn(
          footprint,
          'justify-center border-dashed bg-muted/30 px-2.5 text-xs text-muted-foreground',
        )}
      >
        No agents deployed
      </div>
    )
  }

  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex cursor-pointer items-center gap-2 rounded-lg border border-border-strong bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:border-primary hover:bg-primary-bright/10 disabled:cursor-not-allowed disabled:opacity-50',
          compact ? 'py-1' : 'py-1.5',
        )}
      >
        <span className="max-w-[160px] truncate text-foreground">
          {selected ? formatAgentLabel(selected.name, selected.id) : 'Select agent'}
        </span>
        {!compact && selected && (
          <span className="hidden items-center gap-1 text-muted-foreground sm:flex">
            <Wallet size={10} />
            <span className="tabular-nums">{selected.tbaBalance} STT</span>
          </span>
        )}
        <ChevronDown
          size={12}
          className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>

      <DropdownPanel
        anchorRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        align="end"
        minWidth={220}
        role="listbox"
        className="rounded-xl border-border-strong bg-background shadow-card"
      >
        <div className="border-b border-border px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Your agents
          </p>
        </div>
        <ul className="max-h-56 overflow-y-auto py-1">
          {agents.map((agent) => {
            const isSelected = agent.id.toString() === selectedId
            return (
              <li key={agent.id.toString()}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onSelect(agent.id.toString())
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full cursor-pointer items-center px-3 py-2.5 text-left text-xs transition-colors hover:bg-muted',
                    isSelected && 'bg-primary-bright/15',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-foreground">
                      {formatAgentLabel(agent.name, agent.id)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {agent.tbaBalance} STT · cap {agent.maxPerTask} STT
                    </p>
                  </div>
                  {agent.killSwitch && (
                    <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-destructive">
                      Off
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </DropdownPanel>
    </div>
  )
}
