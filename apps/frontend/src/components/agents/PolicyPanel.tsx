import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { formatEther } from 'viem'
import { Loader2, RefreshCw, Shield } from 'lucide-react'
import { AgentKillSwitchControl } from '@/components/agents/AgentKillSwitchControl'
import { AgentStatusLabel } from '@/components/agents/AgentStatusLabel'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { TwiinAvatar } from '@/components/ui/TwiinAvatar'
import { formatAgentLabel } from '@/lib/agent-name'
import { formatDuration } from '@/lib/format-time'
import { useAgentPolicy, type PullApproval } from '@/hooks/useAgentPolicy'
import type { TwiinAgentInfo } from '@/hooks/useTwiinAgents'
import { cn } from '@/lib/cn'

const DEFAULT_PULL_PER_TICK = '0.2'
const DEFAULT_PULL_PERIOD = '3600'

type PolicyPanelProps = {
  agent: TwiinAgentInfo
  onUpdated: () => void
  onToggleKillSwitch: (agentId: bigint, current: boolean) => Promise<unknown>
  killSwitchDialogAgentId: string | null
  onKillSwitchDialogOpenChange: (agentId: string | null) => void
}

function parsePositiveStt(value: string, label: string): string | null {
 const n = Number(value)
 if (!value || Number.isNaN(n) || n <= 0) return `${label} must be greater than 0`
 return null
}

export function PolicyPanel({
  agent,
  onUpdated,
  onToggleKillSwitch,
  killSwitchDialogAgentId,
  onKillSwitchDialogOpenChange,
}: PolicyPanelProps) {
  const [isTogglingKillSwitch, setIsTogglingKillSwitch] = useState(false)
 const { isSaving, loadPullApproval, updatePolicy, subscribePull, revokePull } =
 useAgentPolicy()

 const [dailyCap, setDailyCap] = useState(agent.dailyCap)
  const [maxPerTask, setMaxPerTask] = useState(agent.maxPerTask)
  const [pullPerTick, setPullPerTick] = useState(DEFAULT_PULL_PER_TICK)
 const [pullPeriod, setPullPeriod] = useState(DEFAULT_PULL_PERIOD)
 const [pullApproval, setPullApproval] = useState<PullApproval | null>(null)
 const [pullLoading, setPullLoading] = useState(false)

 const label = formatAgentLabel(agent.name, agent.id)

  useEffect(() => {
  setDailyCap(agent.dailyCap)
  setMaxPerTask(agent.maxPerTask)
  }, [agent])

 useEffect(() => {
 let cancelled = false
 setPullLoading(true)
 void loadPullApproval(agent.tbaAddress).then((p) => {
 if (!cancelled) {
 setPullApproval(p)
 if (p?.active) {
 setPullPerTick(formatEther(p.perTickWei))
 setPullPeriod(p.periodSeconds.toString())
 }
 }
 if (!cancelled) setPullLoading(false)
 })
 return () => {
 cancelled = true
 }
 }, [agent.tbaAddress, loadPullApproval])

 async function refreshPull() {
 setPullLoading(true)
 try {
 const p = await loadPullApproval(agent.tbaAddress)
 setPullApproval(p)
 } finally {
 setPullLoading(false)
 }
 }

 async function handleSavePolicy() {
 const dailyErr = parsePositiveStt(dailyCap, 'Daily cap')
  const taskErr = parsePositiveStt(maxPerTask, 'Per-task max')
  if (dailyErr || taskErr) {
  toast.error(dailyErr ?? taskErr)
  return
  }
  if (Number(maxPerTask) > Number(dailyCap)) {
  toast.error('Per-task max cannot exceed daily cap')
  return
  }

  try {
  await updatePolicy({
  agentId: agent.id,
  dailyCapStt: dailyCap,
  maxPerTaskStt: maxPerTask,
  killSwitch: agent.killSwitch,
  })
 toast.success('Policy updated on-chain')
 onUpdated()
 } catch (e) {
 toast.error(e instanceof Error ? e.message : 'Policy update failed')
 }
 }

 async function handleSubscribePull() {
 const tickErr = parsePositiveStt(pullPerTick, 'Per-tick pull')
 const period = Number(pullPeriod)
 if (!pullPeriod || Number.isNaN(period) || period <= 0) {
 toast.error('Period must be a positive number of seconds')
 return
 }
 if (tickErr) {
 toast.error(tickErr)
 return
 }

 try {
 await subscribePull({
 tbaAddress: agent.tbaAddress,
 perTickStt: pullPerTick,
 periodSeconds: period,
 })
 toast.success('Refresh pull allowance set — confirm in wallet')
 window.setTimeout(() => void refreshPull(), 2500)
 } catch (e) {
 toast.error(e instanceof Error ? e.message : 'subscribePull failed')
 }
 }

  async function handleToggleKillSwitch(agentId: bigint, current: boolean) {
    setIsTogglingKillSwitch(true)
    try {
      await onToggleKillSwitch(agentId, current)
      onUpdated()
    } finally {
      setIsTogglingKillSwitch(false)
    }
  }

  async function handleRevokePull() {
 try {
 await revokePull(agent.tbaAddress)
 toast.success('Pull allowance revoked')
 window.setTimeout(() => void refreshPull(), 2500)
 } catch (e) {
 toast.error(e instanceof Error ? e.message : 'revokePull failed')
 }
 }

 return (
 <motion.div
 initial={{ opacity: 0, y: 8 }}
 animate={{ opacity: 1, y: 0 }}
 className="overflow-hidden border border-border bg-card shadow-card lg:min-h-[320px]"
 >
      <div className="flex flex-col gap-3 border-b border-border bg-muted/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-primary" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Policy & refresh
          </span>
        </div>
        <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:items-center">
          <AgentStatusLabel frozen={agent.killSwitch} />
          <AgentKillSwitchControl
            agent={agent}
            isToggling={isTogglingKillSwitch}
            onToggle={handleToggleKillSwitch}
            dialogOpen={killSwitchDialogAgentId === agent.id.toString()}
            onDialogOpenChange={(open) =>
              onKillSwitchDialogOpenChange(open ? agent.id.toString() : null)
            }
          />
        </div>
      </div>

 <div className="flex items-center gap-3 border-b border-border/40 px-4 py-3">
 <TwiinAvatar name={agent.name} size="sm" />
 <div className="min-w-0">
 <p className="truncate text-sm font-bold text-foreground">{label}</p>
 <p className="break-words text-[11px] text-muted-foreground">
 Spent today {agent.dailySpent} / {agent.dailyCap} STT · wallet {agent.tbaBalance}{' '}
 STT
 </p>
 </div>
 </div>

 <div className="grid gap-4 p-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
 <section className="min-w-0 space-y-3">
 <h3 className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
 Spend caps
 </h3>
 <label className="block">
 <span className="text-[11px] font-semibold text-muted-foreground">Daily cap (STT)</span>
 <input
 type="text"
 inputMode="decimal"
 value={dailyCap}
 onChange={(e) => setDailyCap(e.target.value)}
 disabled={isSaving}
 className="mt-1 w-full border border-border bg-muted px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/40 disabled:opacity-50"
 />
 </label>
 <label className="block">
 <span className="text-[11px] font-semibold text-muted-foreground">
 Max per task (STT)
 </span>
 <input
 type="text"
 inputMode="decimal"
 value={maxPerTask}
 onChange={(e) => setMaxPerTask(e.target.value)}
 disabled={isSaving}
 className="mt-1 w-full border border-border bg-muted px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/40 disabled:opacity-50"
 />
 </label>

 <Button
 type="button"
 className="w-full"
 disabled={isSaving}
 onClick={() => void handleSavePolicy()}
 >
 {isSaving ? (
 <>
 <Loader2 size={14} className="animate-spin" />
 Saving…
 </>
 ) : (
 'Save policy on-chain'
 )}
 </Button>
 </section>

 <section className="min-w-0 space-y-3">
 <div className="flex items-center justify-between gap-2">
 <h3 className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
 Oracle refresh pull
 </h3>
 <button
 type="button"
 onClick={() => void refreshPull()}
 disabled={pullLoading}
 className="inline-flex cursor-pointer items-center gap-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
 >
 <RefreshCw size={10} className={cn(pullLoading && 'animate-spin')} />
 Sync
 </button>
 </div>
 <p className="text-[11px] leading-relaxed text-muted-foreground">
 Pre-authorise the refresh coordinator to pull STT from this agent&apos;s 6551 wallet for
 chain-side feed refreshes (Somnia Reactivity).
 </p>

 {pullApproval?.active && (
 <div className="break-words border border-success/20 bg-success/5 px-3 py-2 text-[11px] text-muted-foreground">
 Active: up to{' '}
 <strong className="text-foreground">{formatEther(pullApproval.perTickWei)} STT</strong>{' '}
 per tick, every{' '}
 <strong className="text-foreground">
 {formatDuration(Number(pullApproval.periodSeconds))}
 </strong>
 </div>
 )}

 <label className="block">
 <span className="text-[11px] font-semibold text-muted-foreground">Per tick (STT)</span>
 <input
 type="text"
 inputMode="decimal"
 value={pullPerTick}
 onChange={(e) => setPullPerTick(e.target.value)}
 disabled={isSaving}
 className="mt-1 w-full border border-border bg-muted px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/40 disabled:opacity-50"
 />
 </label>
 <label className="block">
 <span className="text-[11px] font-semibold text-muted-foreground">Period (seconds)</span>
 <input
 type="text"
 inputMode="numeric"
 value={pullPeriod}
 onChange={(e) => setPullPeriod(e.target.value)}
 disabled={isSaving}
 className="mt-1 w-full border border-border bg-muted px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/40 disabled:opacity-50"
 />
 </label>

 <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
 <Button
 type="button"
 variant="secondary"
 className="w-full"
 disabled={isSaving}
 onClick={() => void handleSubscribePull()}
 >
 {pullApproval?.active ? 'Update allowance' : 'Subscribe pull'}
 </Button>
 {pullApproval?.active && (
 <Button
 type="button"
 variant="outline"
 className="w-full"
 disabled={isSaving}
 onClick={() => void handleRevokePull()}
 >
 Revoke
 </Button>
 )}
 </div>
 </section>
 </div>
 </motion.div>
 )
}
