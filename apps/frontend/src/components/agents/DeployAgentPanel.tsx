import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Bot, Loader2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { useWaitForTransactionReceipt } from 'wagmi'
import { Button } from '@/components/ui/Button'
import { normalizeAgentName, validateAgentName } from '@/lib/agent-name'
import { somniaTestnet } from '@/config/chains'

const DEFAULT_FUND = '5'
const EXPLORER = somniaTestnet.blockExplorers.default.url

type DeployAgentPanelProps = {
  isConnected: boolean
  mintAgent: (name: string, fundAmountSTT: string) => Promise<`0x${string}`>
  onDeployed: () => void
  embedded?: boolean
}

export function DeployAgentPanel({
  isConnected,
  mintAgent,
  onDeployed,
  embedded = false,
}: DeployAgentPanelProps) {
  const [nameInput, setNameInput] = useState('')
  const [fundStt, setFundStt] = useState(DEFAULT_FUND)
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const name = normalizeAgentName(nameInput)
  const nameError = nameInput.trim() ? validateAgentName(name) : null

  const fundNum = Number(fundStt)
  const fundError =
    !fundStt || Number.isNaN(fundNum) || fundNum <= 0
      ? 'Fund amount must be greater than 0'
      : null

  const { isLoading: isConfirming, isSuccess, isError } =
    useWaitForTransactionReceipt({ hash: txHash })

  useEffect(() => {
    if (!isSuccess || !txHash) return
    toast.success(`Twiin ${name ? `${name}@twiin` : 'agent'} deployed`)
    onDeployed()
    setNameInput('')
    setFundStt(DEFAULT_FUND)
    setTxHash(undefined)
    setIsSubmitting(false)
  }, [isSuccess, txHash, name, onDeployed])

  useEffect(() => {
    if (!isError || !txHash) return
    toast.error('Deploy transaction failed')
    setTxHash(undefined)
    setIsSubmitting(false)
  }, [isError, txHash])

  const busy = isSubmitting || isConfirming

  async function handleDeploy() {
    if (!isConnected) {
      toast.error('Connect wallet first')
      return
    }
    const nErr = validateAgentName(name)
    if (nErr) {
      toast.error(nErr)
      return
    }
    if (fundError) {
      toast.error(fundError)
      return
    }

    setIsSubmitting(true)
    try {
      const hash = await mintAgent(name, fundStt)
      setTxHash(hash)
      toast.message('Deploy submitted — confirm in wallet')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Deploy failed'
      toast.error(msg.length > 120 ? `${msg.slice(0, 120)}…` : msg)
      setIsSubmitting(false)
    }
  }

  const formBody = (
    <>
      <div className={embedded ? 'grid gap-4 sm:grid-cols-2' : 'space-y-4'}>
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Agent name
          </span>
          <div className="flex items-center border border-border bg-muted focus-within:border-primary/40">
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="neo"
              disabled={!isConnected || busy}
              className="w-full bg-transparent px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
            />
            <span className="shrink-0 pr-3 text-xs text-muted-foreground">@twiin</span>
          </div>
          {nameError && (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-danger">
              <AlertTriangle size={12} />
              {nameError}
            </p>
          )}
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Initial wallet fund
          </span>
          <div className="flex items-center border border-border bg-muted focus-within:border-primary/40">
            <input
              type="text"
              inputMode="decimal"
              value={fundStt}
              onChange={(e) => setFundStt(e.target.value.replace(/[^0-9.]/g, ''))}
              disabled={!isConnected || busy}
              className="w-full bg-transparent px-3 py-2.5 text-sm text-foreground outline-none disabled:opacity-50"
            />
            <span className="shrink-0 pr-3 text-xs font-semibold text-muted-foreground">STT</span>
          </div>
          {fundError && fundStt && (
            <p className="mt-1.5 text-xs text-danger">{fundError}</p>
          )}
        </label>
      </div>

      <div className={embedded ? 'mt-4' : 'mt-4 space-y-4'}>
        <Button
          type="button"
          className="w-full"
          disabled={!isConnected || busy || !!nameError || !!fundError || !name}
          onClick={() => void handleDeploy()}
        >
          {busy ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              {isConfirming ? 'Confirming…' : 'Waiting for wallet…'}
            </>
          ) : (
            `Deploy · ${fundStt || '0'} STT`
          )}
        </Button>

        {txHash && (
          <motion.a
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            href={`${EXPLORER}/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 block text-center text-xs text-primary hover:underline"
          >
            View transaction
          </motion.a>
        )}

        {!isConnected && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Connect wallet to deploy
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
        <div className="flex size-8 items-center justify-center bg-primary/15">
          <Bot size={16} className="text-primary" />
        </div>
        <h2 className="text-sm font-bold text-foreground">Deploy Agent</h2>
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground">
        One transaction mints your NFT, creates the ERC-6551 wallet, claims{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">name@twiin</code>,
        and seeds policy (kill switch ON until you enable).
      </p>

      <div className="mt-5">{formBody}</div>
    </div>
  )
}
