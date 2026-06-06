import { type FormEvent, type KeyboardEvent, useRef, useCallback, useLayoutEffect } from 'react'
import { motion } from 'framer-motion'
import { ArrowUp, ChevronDown, ChevronUp } from 'lucide-react'
import { ThinkingSpinner } from '@/components/ui/ThinkingSpinner'

type Props = {
  goal: string
  budgetStt: string
  onGoalChange: (value: string) => void
  onBudgetChange: (value: string) => void
  onSubmit: () => void
  /** Disables goal + budget inputs (agent locked, kill switch, etc.) */
  disabled?: boolean
  /** Disables send only — e.g. budget over cap while inputs stay editable */
  submitDisabled?: boolean
  isPlanning?: boolean
  showHint?: boolean
}

export function CommandBar({
  goal,
  budgetStt,
  onGoalChange,
  onBudgetChange,
  onSubmit,
  disabled,
  submitDisabled,
  isPlanning,
  showHint = true,
}: Props) {
  const inputDisabled = disabled || isPlanning
  const sendDisabled = (submitDisabled ?? disabled) || isPlanning
  const ref = useRef<HTMLTextAreaElement>(null)

  const handleAutoResize = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [])

  useLayoutEffect(() => {
    handleAutoResize()
  }, [goal, handleAutoResize])

  function doSubmit() {
    if (sendDisabled) return
    onSubmit()
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    doSubmit()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      doSubmit()
    }
  }

  function adjustBudget(delta: number) {
    const current = Number(budgetStt)
    const base = Number.isNaN(current) || current <= 0 ? 0.1 : current
    const next = Math.max(0.1, Math.round((base + delta) * 100) / 100)
    onBudgetChange(next.toFixed(2).replace(/\.?0+$/, '') || '0.1')
  }

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit} className="mx-auto max-w-2xl">
        <div className="flex items-start gap-2 rounded-xl border border-border-strong bg-background px-3 py-3 transition-all duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] focus-within:border-primary focus-within:shadow-[0_0_0_3px_rgba(159,232,112,0.25)]">
          <textarea
            ref={ref}
            rows={1}
            value={goal}
            onChange={(e) => {
              onGoalChange(e.target.value)
              handleAutoResize()
            }}
            disabled={inputDisabled}
            onKeyDown={handleKeyDown}
            onInput={handleAutoResize}
            placeholder="Tell your Twiin what to accomplish…"
            className="command-bar-textarea flex-1 resize-none border-none bg-transparent p-0 py-1.5 text-sm leading-snug text-foreground outline-none placeholder:text-muted-foreground/70"
            style={{ height: '36px', maxHeight: '200px', overflowY: 'auto' }}
          />
          <div className="mt-0.5 flex h-9 shrink-0 items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-1 text-[10px] text-muted-foreground">
            <input
              type="text"
              inputMode="decimal"
              value={budgetStt}
              onChange={(e) => onBudgetChange(e.target.value.replace(/[^0-9.]/g, ''))}
              disabled={inputDisabled}
              className="w-9 bg-transparent text-center text-xs tabular-nums text-foreground outline-none disabled:opacity-50"
            />
            <span>STT</span>
            <div className="ml-0.5 flex flex-col border-l border-border pl-0.5">
              <button
                type="button"
                disabled={inputDisabled}
                onClick={() => adjustBudget(0.1)}
                aria-label="Increase budget"
                className="flex cursor-pointer items-center justify-center rounded-sm p-0 text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronUp size={10} strokeWidth={2.5} />
              </button>
              <button
                type="button"
                disabled={inputDisabled}
                onClick={() => adjustBudget(-0.1)}
                aria-label="Decrease budget"
                className="flex cursor-pointer items-center justify-center rounded-sm p-0 text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronDown size={10} strokeWidth={2.5} />
              </button>
            </div>
          </div>
          <motion.button
            whileTap={{ scale: 0.9 }}
            type="submit"
            disabled={sendDisabled}
            aria-label="Send goal"
            className="mt-0.5 flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-primary text-primary-bright transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPlanning ? <ThinkingSpinner className="size-4" /> : <ArrowUp size={16} strokeWidth={2.5} />}
          </motion.button>
        </div>
        {showHint && (
          <p className="mt-1.5 text-center text-xs text-muted-foreground/70">
            {isPlanning ? 'Planning your task…' : 'Enter to plan · Shift+Enter for newline'}
          </p>
        )}
      </form>
    </div>
  )
}
