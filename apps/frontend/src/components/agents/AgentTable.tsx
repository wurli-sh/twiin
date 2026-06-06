import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  ClipboardCopy,
  ExternalLink,
  MoreHorizontal,
} from 'lucide-react'
import { AgentKillSwitchControl } from './AgentKillSwitchControl'
import { AgentStatusLabel } from './AgentStatusLabel'
import { toast } from 'sonner'
import { TwiinAvatar } from '@/components/ui/TwiinAvatar'
import { cn } from '@/lib/cn'
import { formatAgentLabel } from '@/lib/agent-name'
import type { TwiinAgentInfo } from '@/hooks/useTwiinAgents'
import { somniaTestnet } from '@/config/chains'
import { useUIStore } from '@/stores/ui'

const EXPLORER = somniaTestnet.blockExplorers.default.url

type AgentTableProps = {
  agents: TwiinAgentInfo[]
  onSelect: (agentId: string) => void
  onToggleKillSwitch: (agentId: bigint, current: boolean) => Promise<unknown>
  togglingId: bigint | null
}

export function AgentTable({
  agents,
  onSelect,
  onToggleKillSwitch,
  togglingId,
}: AgentTableProps) {
  const selectedAgentId = useUIStore((s) => s.selectedAgentId)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  return (
    <div className="overflow-x-auto border border-border-strong">
      <table className="w-full min-w-[520px] border-collapse text-left">
        <thead className="sticky top-0 z-10 border-b border-primary/20 bg-primary-bright/10">
          <tr>
            {['Agent', 'Status', 'Wallet', 'Daily', 'Task max', 'Actions'].map((col) => (
              <th
                key={col || 'actions'}
                className={cn(
                  'px-2 py-2.5 font-mono text-[10px] font-bold uppercase tracking-widest text-primary/80',
                  col === 'Agent' && 'w-[120px] max-w-[120px]',
                  col === 'Status' && 'w-28',
                  col === 'Actions' && 'w-10',
                )}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => {
            const idStr = agent.id.toString()
            const isSelected = selectedAgentId === idStr
            const label = formatAgentLabel(agent.name, agent.id)
            const isToggling = togglingId === agent.id

            return (
              <tr
                key={idStr}
                onClick={() => onSelect(idStr)}
                className={cn(
                  'cursor-pointer border-b border-border/60 transition-colors hover:bg-primary-bright/15',
                  isSelected &&
                    'border-l-[3px] border-l-primary-bright bg-primary-bright/20 shadow-[inset_0_0_0_1px_oklch(0.75_0.18_130_/_0.12)]',
                )}
              >
                <td className="w-[120px] max-w-[120px] px-2 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <TwiinAvatar name={agent.name} size="sm" />
                    <p className="truncate text-sm font-semibold text-foreground" title={label}>
                      {label}
                    </p>
                  </div>
                </td>
                <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-col items-start gap-1.5">
                    <AgentStatusLabel frozen={agent.killSwitch} />
                    <AgentKillSwitchControl
                      agent={agent}
                      isToggling={isToggling}
                      onToggle={onToggleKillSwitch}
                    />
                  </div>
                </td>
                <td className="w-20 px-2 py-2.5 font-mono text-xs tabular-nums text-foreground">
                  {agent.tbaBalance}
                </td>
                <td className="w-24 px-2 py-2.5 font-mono text-xs tabular-nums text-foreground">
                  {agent.dailySpent}/{agent.dailyCap}
                </td>
                <td className="w-16 px-2 py-2.5 font-mono text-xs tabular-nums text-foreground">
                  {agent.maxPerTask}
                </td>
                <td className="w-10 px-2 py-2.5">
                  <AgentActionsMenu
                    agent={agent}
                    idStr={idStr}
                    isOpen={openMenuId === idStr}
                    isCopied={copiedId === idStr}
                    onOpenChange={(open) => setOpenMenuId(open ? idStr : null)}
                    onCopy={async () => {
                      await navigator.clipboard.writeText(agent.tbaAddress)
                      setCopiedId(idStr)
                      toast.success('6551 address copied')
                      window.setTimeout(() => setCopiedId(null), 1500)
                      setOpenMenuId(null)
                    }}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

type AgentActionsMenuProps = {
  agent: TwiinAgentInfo
  idStr: string
  isOpen: boolean
  isCopied: boolean
  onOpenChange: (open: boolean) => void
  onCopy: () => void
}

function AgentActionsMenu({
  agent,
  idStr,
  isOpen,
  isCopied,
  onOpenChange,
  onCopy,
}: AgentActionsMenuProps) {
  const setSelectedAgentId = useUIStore((s) => s.setSelectedAgentId)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onOpenChange(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen, onOpenChange])

  return (
    <div className="relative" ref={menuRef} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        title="Actions"
        onClick={() => onOpenChange(!isOpen)}
        className="inline-flex size-7 cursor-pointer items-center justify-center border border-border text-muted-foreground hover:bg-primary-bright/20 hover:text-foreground"
      >
        <MoreHorizontal size={14} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-20 mt-1 min-w-[152px] border border-border bg-card py-1 shadow-elev">
          <MenuItem
            icon={<ClipboardCopy size={12} />}
            label={isCopied ? 'Copied' : 'Copy 6551'}
            onClick={() => void onCopy()}
          />
          <MenuItem
            icon={<ExternalLink size={12} />}
            label="Explorer"
            href={`${EXPLORER}/address/${agent.tbaAddress}`}
            external
            onClick={() => onOpenChange(false)}
          />
          <MenuItem
            icon={<ArrowRight size={12} />}
            label="Open console"
            onClick={() => {
              setSelectedAgentId(idStr)
              onOpenChange(false)
            }}
            asLink
            to="/console"
          />
        </div>
      )}
    </div>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
  href,
  to,
  external,
  disabled,
  asLink,
}: {
  icon: React.ReactNode
  label: string
  onClick?: () => void
  href?: string
  to?: string
  external?: boolean
  disabled?: boolean
  asLink?: boolean
}) {
  const className = cn(
    'group flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs font-medium text-foreground hover:bg-primary-bright/20 disabled:cursor-not-allowed disabled:opacity-50',
  )

  if (href) {
    return (
      <a
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        className={className}
        onClick={onClick}
      >
        <span className="text-muted-foreground group-hover:text-foreground">{icon}</span>
        {label}
      </a>
    )
  }

  if (asLink && to) {
    return (
      <Link to={to} className={className} onClick={onClick}>
        <span className="text-muted-foreground group-hover:text-foreground">{icon}</span>
        {label}
      </Link>
    )
  }

  return (
    <button type="button" disabled={disabled} className={className} onClick={onClick}>
      <span className="text-muted-foreground group-hover:text-foreground">{icon}</span>
      {label}
    </button>
  )
}
