import { useState } from 'react'
import { Bot, Globe } from 'lucide-react'
import { cn } from '@/lib/cn'
import { DeployAgentPanel } from '@/components/agents/DeployAgentPanel'
import { ExternalAgentPanel } from '@/components/agents/ExternalAgentPanel'
import type { SubAgentInfo } from '@/hooks/useSubAgents'

type AgentMode = 'twiin' | 'external'

type AddAgentPanelProps = {
  isConnected: boolean
  mintAgent: (name: string, fundAmountSTT: string) => Promise<`0x${string}`>
  onDeployed: () => void
  subAgents: SubAgentInfo[]
  onExternalUpdated: () => void
}

const MODE_OPTIONS: { key: AgentMode; label: string }[] = [
  { key: 'twiin', label: 'Twiin' },
  { key: 'external', label: 'External' },
]

export function AddAgentPanel({
  isConnected,
  mintAgent,
  onDeployed,
  subAgents,
  onExternalUpdated,
}: AddAgentPanelProps) {
  const [mode, setMode] = useState<AgentMode>('twiin')

  return (
    <div className="mb-6 border border-border bg-card p-5 shadow-card">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'flex size-8 items-center justify-center',
              mode === 'twiin' ? 'bg-primary' : 'bg-warning/15',
            )}
          >
            {mode === 'twiin' ? (
              <Bot size={16} className="text-primary-bright" />
            ) : (
              <Globe size={16} className="text-warning" />
            )}
          </div>
          <h2 className="text-sm font-bold text-foreground">Add Agent</h2>
        </div>

        <div className="flex border border-border-strong bg-muted/40 p-0.5">
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setMode(option.key)}
              className={cn(
                'cursor-pointer px-3 py-1.5 text-xs font-semibold transition-colors',
                mode === option.key
                  ? option.key === 'twiin'
                    ? 'bg-primary-bright/30 text-primary shadow-soft'
                    : 'bg-warning/20 text-warning shadow-soft'
                  : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        {mode === 'twiin' ? (
          <>
            Mint NFT, create 6551 wallet, claim{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">name@twiin</code> in one tx.
          </>
        ) : (
          <>
            Register an HTTP worker on-chain with{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">data.specialized</code>{' '}
            capability and a 5 STT deposit.
          </>
        )}
      </p>

      <div className="mt-5 border-t border-border pt-5">
        {mode === 'twiin' ? (
          <DeployAgentPanel
            embedded
            isConnected={isConnected}
            mintAgent={mintAgent}
            onDeployed={onDeployed}
          />
        ) : (
          <ExternalAgentPanel
            embedded
            agents={subAgents}
            onUpdated={onExternalUpdated}
          />
        )}
      </div>
    </div>
  )
}
