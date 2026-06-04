import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  ClipboardCopy,
  ExternalLink,
  Loader2,
  Power,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/Badge'
import { TwiinAvatar } from '@/components/ui/TwiinAvatar'
import { cn } from '@/lib/cn'
import { formatAgentLabel } from '@/lib/agent-name'
import type { TwiinAgentInfo } from '@/hooks/useTwiinAgents'
import { somniaTestnet } from '@/config/chains'
import { useUIStore } from '@/stores/ui'

const EXPLORER = somniaTestnet.blockExplorers.default.url

type AgentRowProps = {
  agent: TwiinAgentInfo
  onToggleKillSwitch: (agentId: bigint, current: boolean) => Promise<unknown>
  onSelect?: (agentId: string) => void
  togglingId: bigint | null
}

export function AgentRow({ agent, onToggleKillSwitch, onSelect, togglingId }: AgentRowProps) {
  const [copied, setCopied] = useState(false)
  const setSelectedAgentId = useUIStore((s) => s.setSelectedAgentId)
  const selectedAgentId = useUIStore((s) => s.selectedAgentId)
  const idStr = agent.id.toString()
  const isSelected = selectedAgentId === idStr
  const label = formatAgentLabel(agent.name, agent.id)
  const isToggling = togglingId === agent.id

  async function copyAddress() {
    await navigator.clipboard.writeText(agent.tbaAddress)
    setCopied(true)
    toast.success('6551 address copied')
    window.setTimeout(() => setCopied(false), 1500)
  }

  function selectForConsole() {
    setSelectedAgentId(idStr)
  }

  return (
    <motion.div
      layout
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(idStr)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect?.(idStr)
        }
      }}
      className={cn(
        'flex cursor-pointer flex-col gap-3 border-b border-border/40 p-4 last:border-b-0 sm:flex-row sm:items-center',
        isSelected && 'bg-primary/5',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <TwiinAvatar name={agent.name} size="md" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-bold text-text">{label}</p>
            <Badge variant={agent.killSwitch ? 'danger' : 'success'}>
              {agent.killSwitch ? 'Frozen' : 'Active'}
            </Badge>
            {isSelected && <Badge variant="default">Selected</Badge>}
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-text-faint truncate">
            {agent.tbaAddress}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:w-56 shrink-0">
        <Stat label="Wallet" value={`${agent.tbaBalance} STT`} icon={Wallet} />
        <Stat label="Daily" value={`${agent.dailySpent}/${agent.dailyCap}`} />
        <Stat label="Task max" value={`${agent.maxPerTask} STT`} />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            void copyAddress()
          }}
          className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-text-muted hover:bg-surface-alt"
        >
          <ClipboardCopy size={12} />
          {copied ? 'Copied' : '6551'}
        </button>
        <a
          href={`${EXPLORER}/address/${agent.tbaAddress}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-text-muted hover:bg-surface-alt"
        >
          <ExternalLink size={12} />
        </a>
        <button
          type="button"
          disabled={isToggling}
          onClick={(e) => {
            e.stopPropagation()
            void onToggleKillSwitch(agent.id, agent.killSwitch).catch((err) => {
              toast.error(err instanceof Error ? err.message : 'Toggle failed')
            })
          }}
          className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-text-muted hover:bg-surface-alt disabled:opacity-50"
        >
          {isToggling ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Power size={12} />
          )}
          {agent.killSwitch ? 'Enable' : 'Freeze'}
        </button>
        <Link
          to="/console"
          onClick={(e) => {
            e.stopPropagation()
            selectForConsole()
          }}
          className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-bold text-secondary hover:bg-primary/90"
        >
          Console
          <ArrowRight size={12} />
        </Link>
      </div>
    </motion.div>
  )
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon?: typeof Wallet
}) {
  return (
    <div className="rounded-lg bg-surface-alt px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wider text-text-faint">{label}</p>
      <p className="flex items-center gap-1 truncate text-xs font-bold text-text">
        {Icon && <Icon size={10} className="shrink-0 text-text-faint" />}
        {value}
      </p>
    </div>
  )
}
