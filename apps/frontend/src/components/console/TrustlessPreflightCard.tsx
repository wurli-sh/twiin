type Props = {
  minBudgetStt: string
  janiceCostStt: string
  maxIterations: number
  warnings: string[]
}

export function TrustlessPreflightCard({
  minBudgetStt,
  janiceCostStt,
  maxIterations,
  warnings,
}: Props) {
  return (
    <div className="max-w-[92%] border border-primary/25 bg-primary-bright/5 px-3 py-2.5 text-sm text-foreground">
      <p className="font-semibold text-primary">Trustless preflight passed</p>
      <p className="mt-0.5 text-muted-foreground">
        Minimum budget {minBudgetStt} STT · Janice round cost {janiceCostStt} STT · max{' '}
        {maxIterations} iterations
      </p>
      {warnings.length > 0 && (
        <div className="mt-1.5 space-y-1 text-xs text-muted-foreground">
          {warnings.map((warning, idx) => (
            <p key={`warning-${idx}`}>{warning}</p>
          ))}
        </div>
      )}
    </div>
  )
}
