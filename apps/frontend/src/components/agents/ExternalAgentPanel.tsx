import { useEffect, useMemo, useState } from 'react'
import { Globe, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { parseEther } from 'viem'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CONTRACTS, AgentRegistryAbi, CapabilityId } from '@/config/contracts'
import { somniaTestnet } from '@/config/chains'
import type { SubAgentInfo } from '@/hooks/useSubAgents'

const DEFAULT_NAME = 'discord-bot@twiin'
const DEFAULT_ENDPOINT = 'https://discord-bot-twiin.onrender.com'
const DEFAULT_COST = '0.15'
const DEFAULT_DEPOSIT = '5'

type ExternalAgentPanelProps = {
  agents: SubAgentInfo[]
  onUpdated: () => void
  embedded?: boolean
}

export function ExternalAgentPanel({
  agents,
  onUpdated,
  embedded = false,
}: ExternalAgentPanelProps) {
  const { address, isConnected } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const [name, setName] = useState(DEFAULT_NAME)
  const [endpointUrl, setEndpointUrl] = useState(DEFAULT_ENDPOINT)
  const [costStt, setCostStt] = useState(DEFAULT_COST)
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingAction, setPendingAction] = useState<'register' | 'update' | null>(null)

  const existingAgent = useMemo(
    () =>
      agents.find(
        (agent) =>
          agent.lane === 'ExternalHTTP' &&
          agent.registrant?.toLowerCase() === address?.toLowerCase(),
      ) ?? null,
    [agents, address],
  )

  useEffect(() => {
    if (!existingAgent) return
    setName(existingAgent.name)
    setEndpointUrl(existingAgent.endpointUrl ?? endpointUrl)
    setCostStt(existingAgent.cost)
  }, [existingAgent])

  const { isLoading: isConfirming, isSuccess, isError } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  useEffect(() => {
    if (!isSuccess || !txHash) return
    toast.success(
      pendingAction === 'update'
        ? 'External agent update confirmed'
        : 'External agent registration confirmed',
    )
    setTxHash(undefined)
    setIsSubmitting(false)
    setPendingAction(null)
    onUpdated()
  }, [isSuccess, txHash, pendingAction, onUpdated])

  useEffect(() => {
    if (!isError || !txHash) return
    toast.error('External agent transaction failed')
    setTxHash(undefined)
    setIsSubmitting(false)
    setPendingAction(null)
  }, [isError, txHash])

  const busy = isSubmitting || isConfirming
  const endpointError =
    !endpointUrl.trim() || !/^https?:\/\/.+/i.test(endpointUrl.trim())
      ? 'Enter a valid public http(s) endpoint'
      : null
  const costNum = Number(costStt)
  const costError =
    !costStt || Number.isNaN(costNum) || costNum <= 0 ? 'Cost must be greater than 0' : null

  async function handleSubmit() {
    if (!isConnected || !address) {
      toast.error('Connect wallet first')
      return
    }
    if (endpointError || costError) {
      toast.error(endpointError ?? costError ?? 'Invalid form')
      return
    }

    setIsSubmitting(true)
    try {
      if (existingAgent) {
        setPendingAction('update')
        const endpointTx = await writeContractAsync({
          chainId: somniaTestnet.id,
          address: CONTRACTS.agentRegistry.address,
          abi: AgentRegistryAbi,
          functionName: 'updateEndpoint',
          args: [BigInt(existingAgent.configId), endpointUrl.trim()],
        } as never)
        await new Promise((resolve) => setTimeout(resolve, 300))
        const costTx = await writeContractAsync({
          chainId: somniaTestnet.id,
          address: CONTRACTS.agentRegistry.address,
          abi: AgentRegistryAbi,
          functionName: 'updateCost',
          args: [BigInt(existingAgent.configId), parseEther(costStt)],
        } as never)
        setTxHash(costTx)
        toast.message(`Endpoint update submitted (${endpointTx.slice(0, 10)}…)`)
        return
      }

      setPendingAction('register')
      const hash = await writeContractAsync({
        chainId: somniaTestnet.id,
        address: CONTRACTS.agentRegistry.address,
        abi: AgentRegistryAbi,
        functionName: 'registerExternalAgent',
        args: [
          name.trim(),
          endpointUrl.trim(),
          parseEther(costStt),
          [CapabilityId.WEB_SCRAPE_DISCORD],
        ],
        value: parseEther(DEFAULT_DEPOSIT),
      } as never)
      setTxHash(hash)
      toast.message('External registration submitted — confirm in wallet')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'External agent transaction failed'
      toast.error(message.length > 140 ? `${message.slice(0, 140)}…` : message)
      setIsSubmitting(false)
      setPendingAction(null)
    }
  }

  const formBody = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={existingAgent ? 'default' : 'warning'}>
          {existingAgent ? `Config #${existingAgent.configId}` : 'Not registered'}
        </Badge>
        {existingAgent && (
          <Badge variant={existingAgent.isVerified ? 'success' : 'warning'}>
            {existingAgent.isVerified ? 'Verified' : 'Pending verify'}
          </Badge>
        )}
      </div>

      {existingAgent?.lastError && (
        <div className="mt-3 border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">
          Last verify error: {existingAgent.lastError}
        </div>
      )}

      <div className="mt-4 space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Agent name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isConnected || !!existingAgent || busy}
            className="w-full border border-border bg-muted px-3 py-2.5 text-sm text-foreground outline-none disabled:opacity-50"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Public endpoint
          </span>
          <input
            type="url"
            value={endpointUrl}
            onChange={(e) => setEndpointUrl(e.target.value)}
            placeholder="https://discord-bot-twiin.onrender.com"
            disabled={!isConnected || busy}
            className="w-full border border-border bg-muted px-3 py-2.5 text-sm text-foreground outline-none disabled:opacity-50"
          />
          {endpointError && <p className="mt-1 text-xs text-danger">{endpointError}</p>}
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Cost per step
          </span>
          <div className="flex items-center border border-border bg-muted">
            <input
              type="text"
              inputMode="decimal"
              value={costStt}
              onChange={(e) => setCostStt(e.target.value.replace(/[^0-9.]/g, ''))}
              disabled={!isConnected || busy}
              className="w-full bg-transparent px-3 py-2.5 text-sm text-foreground outline-none disabled:opacity-50"
            />
            <span className="pr-3 text-xs font-semibold text-muted-foreground">STT</span>
          </div>
          {costError && <p className="mt-1 text-xs text-danger">{costError}</p>}
        </label>

        <div className="border border-border bg-muted/70 px-3 py-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            {existingAgent?.isVerified ? (
              <ShieldCheck size={14} className="text-success" />
            ) : (
              <ShieldAlert size={14} className="text-warning" />
            )}
            Backend verification is driven by
            <code className="mx-1 rounded bg-card px-1 py-0.5">GET /health</code>
            and a signed
            <code className="mx-1 rounded bg-card px-1 py-0.5">POST /execute</code>
            probe.
          </div>
          {existingAgent?.lastVerifiedAt && (
            <p className="mt-2">
              Last verified: {new Date(existingAgent.lastVerifiedAt * 1000).toLocaleString()}
            </p>
          )}
        </div>

        <Button
          type="button"
          className="w-full"
          disabled={!isConnected || busy || !!endpointError || !!costError}
          onClick={() => void handleSubmit()}
        >
          {busy ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              {isConfirming ? 'Confirming…' : 'Waiting for wallet…'}
            </>
          ) : existingAgent ? (
            'Update External Agent'
          ) : (
            `Register External Agent · ${DEFAULT_DEPOSIT} STT deposit`
          )}
        </Button>

        {!isConnected && (
          <p className="text-center text-xs text-muted-foreground">
            Connect wallet to register
          </p>
        )}
      </div>
    </>
  )

  if (embedded) {
    return formBody
  }

  return (
    <div className="border border-border bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex size-8 items-center justify-center bg-warning/15">
          <Globe size={16} className="text-warning" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-foreground">External Agent</h2>
          <p className="text-xs text-muted-foreground">Register or update your HTTP competitor</p>
        </div>
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground">
        This wires a public HTTP worker into the registry with
        <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">web.scrape.discord</code>
        capability and a 5 STT deposit.
      </p>

      <div className="mt-4">{formBody}</div>
    </div>
  )
}
