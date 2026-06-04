import { ChevronDown } from 'lucide-react'
import { TwiinAvatar } from '@/components/ui/TwiinAvatar'
import { formatAgentLabel } from '@/lib/agent-name'
import type { TwiinAgentInfo } from '@/hooks/useTwiinAgents'
import { cn } from '@/lib/cn'

type AgentSelectorProps = {
  agents: TwiinAgentInfo[]
  selectedId: string | null
  onSelect: (id: string) => void
  disabled?: boolean
}

export function AgentSelector({
  agents,
  selectedId,
  onSelect,
  disabled,
}: AgentSelectorProps) {
  const selected = agents.find((a) => a.id.toString() === selectedId) ?? agents[0]

  if (agents.length === 0) {
    return (
      <p className="text-xs text-text-faint">
        No agents — deploy one on the Agents page first.
      </p>
    )
  }

  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-text-faint">
        Active agent
      </span>
      <div className="relative">
        <div className="pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
          {selected && <TwiinAvatar name={selected.name} size="sm" />}
        </div>
        <select
          value={selectedId ?? selected?.id.toString() ?? ''}
          onChange={(e) => onSelect(e.target.value)}
          disabled={disabled}
          className={cn(
            'w-full cursor-pointer appearance-none rounded-xl border border-border bg-surface-alt py-2.5 pl-11 pr-9 text-sm font-semibold text-text outline-none focus:border-primary/40 disabled:opacity-50',
          )}
        >
          {agents.map((agent) => (
            <option key={agent.id.toString()} value={agent.id.toString()}>
              {formatAgentLabel(agent.name, agent.id)} · {agent.tbaBalance} STT
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-faint"
        />
      </div>
      {selected?.killSwitch && (
        <p className="mt-1.5 text-xs text-danger">
          Kill switch is ON — enable the agent before running tasks.
        </p>
      )}
    </label>
  )
}
