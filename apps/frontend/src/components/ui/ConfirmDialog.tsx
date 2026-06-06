import { useEffect, useId } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

type ConfirmDialogProps = {
  open: boolean
  title: string
  description: React.ReactNode
  confirmLabel: string
  cancelLabel?: string
  confirmVariant?: 'primary' | 'secondary' | 'outline' | 'danger'
  isLoading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  isLoading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, isLoading, onCancel])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        disabled={isLoading}
        className="absolute inset-0 bg-charcoal/40 backdrop-blur-[2px]"
        onClick={() => {
          if (!isLoading) onCancel()
        }}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={cn(
          'relative w-full max-w-md border border-border bg-card p-5 shadow-elev',
        )}
      >
        <h2 id={titleId} className="text-sm font-bold text-foreground">
          {title}
        </h2>
        <div id={descriptionId} className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {description}
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isLoading}
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            size="sm"
            disabled={isLoading}
            onClick={onConfirm}
          >
            {isLoading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Confirm in wallet…
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
