import { useState } from 'react'
import { Loader2, Power, Snowflake } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { formatAgentLabel } from '@/lib/agent-name'
import type { TwiinAgentInfo } from '@/hooks/useTwiinAgents'
import { cn } from '@/lib/cn'

type AgentKillSwitchControlProps = {
  agent: TwiinAgentInfo
  isToggling: boolean
  onToggle: (agentId: bigint, current: boolean) => Promise<unknown>
  className?: string
}

export function AgentKillSwitchControl({
  agent,
  isToggling,
  onToggle,
  className,
}: AgentKillSwitchControlProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const label = formatAgentLabel(agent.name, agent.id)
  const isFrozen = agent.killSwitch

  async function handleConfirm() {
    try {
      await onToggle(agent.id, agent.killSwitch)
      toast.success(isFrozen ? 'Agent enabled' : 'Agent frozen')
      setDialogOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Toggle failed')
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={isToggling}
        className={cn(
          'inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          isFrozen
            ? 'border-primary/30 bg-primary-bright/25 text-primary hover:bg-primary-bright/40'
            : 'border-border-strong bg-background text-foreground hover:border-destructive/35 hover:bg-destructive/5 hover:text-destructive',
          className,
        )}
        onClick={(e) => {
          e.stopPropagation()
          setDialogOpen(true)
        }}
      >
        {isToggling ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            {isFrozen ? 'Enabling…' : 'Freezing…'}
          </>
        ) : isFrozen ? (
          <>
            <Power size={12} />
            Enable
          </>
        ) : (
          <>
            <Snowflake size={12} />
            Freeze
          </>
        )}
      </button>

      <ConfirmDialog
        open={dialogOpen}
        title={isFrozen ? 'Enable agent?' : 'Freeze agent?'}
        description={
          isFrozen ? (
            <>
              <strong className="text-foreground">{label}</strong> is currently frozen and cannot
              accept new tasks. Enabling will call{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">toggleKillSwitch</code> on
              chain and allow planning again.
            </>
          ) : (
            <>
              Freezing <strong className="text-foreground">{label}</strong> will call{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">toggleKillSwitch</code> on
              chain and block all new tasks until you enable it again. Wallet funds stay in the 6551
              account.
            </>
          )
        }
        confirmLabel={isFrozen ? 'Enable on-chain' : 'Freeze on-chain'}
        confirmVariant={isFrozen ? 'secondary' : 'danger'}
        isLoading={isToggling}
        onConfirm={() => void handleConfirm()}
        onCancel={() => {
          if (!isToggling) setDialogOpen(false)
        }}
      />
    </>
  )
}
