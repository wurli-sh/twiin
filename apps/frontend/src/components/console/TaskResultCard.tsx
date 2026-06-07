import { motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import {
  AlertCircle,
  CheckCircle2,
  Coins,
  FileText,
  Scale,
  ShieldAlert,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import type { ExecutionMode } from '@/config/features'
import { consolePageTheme } from '@/lib/execution-mode-theme'
import { cn } from '@/lib/cn'
import {
  budgetUsagePercent,
  parseReportMarkdown,
  type ReportSection,
} from '@/lib/report-display'

type Props = {
  text: string
  spent?: string
  budget?: string
  aborted?: boolean
  taskId?: string
  executionMode?: ExecutionMode
}

const markdownComponents: Components = {
  h2: ({ children }) => (
    <h2 className="mt-4 mb-2 text-sm font-semibold tracking-tight text-foreground first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 mb-1.5 text-xs font-semibold text-foreground">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mb-2 text-xs leading-relaxed text-foreground/85 last:mb-0">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="text-[11px] text-muted-foreground not-italic">{children}</em>
  ),
  ul: ({ children }) => (
    <ul className="mb-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-foreground/85">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-foreground/85">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  hr: () => <div className="my-3 h-px bg-border/70" role="separator" />,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-primary/30 pl-3 text-xs text-muted-foreground">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-md border border-border/80">
      <table className="w-full min-w-[220px] text-left text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-border bg-muted/50 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </thead>
  ),
  tbody: ({ children }) => <tbody className="divide-y divide-border/60">{children}</tbody>,
  tr: ({ children }) => <tr className="hover:bg-muted/30">{children}</tr>,
  th: ({ children }) => <th className="px-3 py-2">{children}</th>,
  td: ({ children }) => (
    <td className="px-3 py-2 font-medium tabular-nums text-foreground">{children}</td>
  ),
}

function sectionIcon(title: string) {
  const lower = title.toLowerCase()
  if (lower.includes('risk') || lower.includes('volatility')) {
    return ShieldAlert
  }
  if (lower.includes('tokenomic') || lower.includes('incentive')) {
    return Coins
  }
  if (lower.includes('conclusion') || lower.includes('suitability') || lower.includes('balanced')) {
    return Scale
  }
  if (lower.includes('sentiment') || lower.includes('metric')) {
    return TrendingUp
  }
  if (lower.includes('unavailable') || lower.includes('note')) {
    return AlertCircle
  }
  return Sparkles
}

function ReportSectionCard({ section, index }: { section: ReportSection; index: number }) {
  const Icon = section.title ? sectionIcon(section.title) : FileText

  if (!section.title) {
    return (
      <div className="text-xs leading-relaxed text-foreground/85">
        <ReactMarkdown components={markdownComponents}>{section.content}</ReactMarkdown>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.04 }}
      className="rounded-md border border-border/70 bg-background px-3 py-2.5 shadow-soft"
    >
      <div className="mb-1.5 flex items-start gap-2">
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm bg-primary-bright/25 text-primary">
          <Icon size={11} strokeWidth={2.25} />
        </span>
        <h4 className="text-xs font-semibold leading-snug text-foreground">{section.title}</h4>
      </div>
      {section.content ? (
        <div className="pl-7">
          <ReactMarkdown components={markdownComponents}>{section.content}</ReactMarkdown>
        </div>
      ) : null}
    </motion.div>
  )
}

function BudgetFooter({ spent, budget }: { spent: string; budget: string }) {
  const pct = budgetUsagePercent(spent, budget)
  const underBudget = pct < 85

  return (
    <div className="mt-3 border-t border-border/70 pt-2.5">
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="font-medium text-muted-foreground">Task budget</span>
        <span className="tabular-nums text-foreground">
          <span className="font-semibold">{spent}</span>
          <span className="text-muted-foreground"> / {budget} STT</span>
        </span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${pct.toFixed(0)}% of task budget used`}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            underBudget ? 'bg-primary' : 'bg-warning',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export function TaskResultCard({
  text,
  spent,
  budget,
  aborted,
  taskId,
  executionMode: _executionMode = 'claude',
}: Props) {
  void _executionMode
  const modeTheme = consolePageTheme()

  if (aborted) {
    return (
      <div className="max-w-[92%] overflow-hidden rounded-lg border border-destructive/30 bg-destructive/5 shadow-soft">
        <div className="flex items-center gap-2 border-b border-destructive/20 px-3 py-2">
          <AlertCircle size={14} className="text-destructive" />
          <p className="text-xs font-semibold text-destructive">Task aborted</p>
        </div>
        <div className="px-3 py-2.5 text-xs leading-relaxed text-destructive/90">
          <ReactMarkdown components={markdownComponents}>{text}</ReactMarkdown>
        </div>
      </div>
    )
  }

  const parsed = parseReportMarkdown(text)
  const hasSections = parsed.sections.length > 1 || parsed.sections.some((s) => s.title)

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
      className={cn('max-w-[92%] overflow-hidden rounded-lg border shadow-card', modeTheme.agentCard)}
    >
      <div
        className={cn(
          'flex items-start justify-between gap-3 border-b px-3 py-2.5',
          modeTheme.resultHeader,
        )}
      >
        <div className="flex min-w-0 items-start gap-2">
          <span
            className={cn(
              'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md',
              modeTheme.resultIcon,
            )}
          >
            <CheckCircle2 size={13} strokeWidth={2.5} />
          </span>
          <div className="min-w-0">
            <p className={cn('text-[10px] font-medium uppercase tracking-wide', modeTheme.text)}>
              Agent report
            </p>
            <h3 className="truncate text-sm font-semibold leading-snug text-foreground">
              {parsed.title}
            </h3>
            {taskId && (
              <p className="mt-0.5 text-[10px] text-muted-foreground">Task #{taskId}</p>
            )}
          </div>
        </div>
        {spent && budget && (
          <div className="shrink-0 rounded-md border border-border/80 bg-background px-2 py-1 text-right">
            <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
              Spent
            </p>
            <p className="text-[11px] font-semibold tabular-nums text-foreground">
              {spent} <span className="font-normal text-muted-foreground">STT</span>
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2 px-3 py-3">
        {hasSections ? (
          parsed.sections.map((section, i) => (
            <ReportSectionCard key={`${section.title}-${i}`} section={section} index={i} />
          ))
        ) : (
          <div
            className={cn(
              parsed.isMetricTable &&
                'rounded-md border border-border/70 bg-background p-2.5 shadow-soft',
            )}
          >
            <ReactMarkdown components={markdownComponents}>
              {parsed.sections[0]?.content ?? text}
            </ReactMarkdown>
          </div>
        )}

        {parsed.footnote && (
          <p className="text-[10px] leading-relaxed text-muted-foreground">{parsed.footnote}</p>
        )}
      </div>

      {spent && budget && (
        <div className="px-3 pb-3">
          <BudgetFooter spent={spent} budget={budget} />
        </div>
      )}
    </motion.div>
  )
}
