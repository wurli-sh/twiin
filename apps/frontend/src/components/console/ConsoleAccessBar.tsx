import { type ReactNode } from 'react'
import { Loader2, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useWallet } from '@/hooks/useWallet'
import { useNetworkGuard } from '@/hooks/useNetworkGuard'
import { cn } from '@/lib/cn'

type AccessItem = {
  text: string
  severity: 'warning' | 'destructive' | 'info'
  action?: ReactNode
}

type Props = {
  agentsLoading?: boolean
  hasAgents?: boolean
  className?: string
}

export function ConsoleAccessBar({
  agentsLoading = false,
  hasAgents = false,
  className,
}: Props) {
  const { isConnected, isConnecting, connectors, connectWith } = useWallet()
  const { wrongNetwork, isSwitching, switchToSomnia, targetName } = useNetworkGuard()

  const items: AccessItem[] = []

  if (!isConnected) {
    items.push({
      text: 'Wallet not connected — connect to plan tasks, approve on-chain, and watch live execution.',
      severity: 'warning',
      action: (
        <button
          type="button"
          disabled={isConnecting || connectors.length === 0}
          onClick={() => {
            const connector = connectors[0]
            if (connector) connectWith(connector)
          }}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-warning/40 bg-background px-2.5 py-1 text-xs font-medium text-warning transition-colors hover:bg-warning/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isConnecting ? <Loader2 size={12} className="animate-spin" /> : <Wallet size={12} />}
          {isConnecting ? 'Connecting…' : 'Connect wallet'}
        </button>
      ),
    })
  }

  if (isConnected && wrongNetwork) {
    items.push({
      text: `Wrong network — switch to ${targetName} before planning or signing tasks.`,
      severity: 'destructive',
      action: (
        <button
          type="button"
          disabled={isSwitching}
          onClick={() => switchToSomnia()}
          className="shrink-0 rounded-md border border-destructive/40 bg-background px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
        >
          {isSwitching ? 'Switching…' : 'Switch network'}
        </button>
      ),
    })
  }

  if (isConnected && !wrongNetwork && !agentsLoading && !hasAgents) {
    items.push({
      text: 'No Twiin agent deployed — mint an agent on the Agents page before running tasks.',
      severity: 'info',
      action: (
        <Link
          to="/agents"
          className="shrink-0 rounded-md border border-border-strong bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary hover:bg-primary-bright/10 hover:text-primary"
        >
          Deploy agent
        </Link>
      ),
    })
  }

  if (items.length === 0) return null

  return (
    <div
      className={cn(
        'flex flex-col gap-2',
        className,
      )}
    >
      {items.map((item) => (
        <div
          key={item.text}
          className={cn(
            'flex items-start gap-2 rounded-lg border px-3 py-2',
            item.severity === 'destructive' && 'border-destructive/30 bg-destructive/5',
            item.severity === 'warning' && 'border-warning/30 bg-warning/5',
            item.severity === 'info' && 'border-border-strong bg-muted/40',
          )}
        >
          <p
            className={cn(
              'min-w-0 flex-1 text-xs leading-snug',
              item.severity === 'destructive' && 'text-destructive',
              item.severity === 'warning' && 'text-warning',
              item.severity === 'info' && 'text-muted-foreground',
            )}
          >
            {item.text}
          </p>
          {item.action}
        </div>
      ))}
    </div>
  )
}
