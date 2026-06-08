import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'

type DropdownPanelProps = {
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
  align?: 'start' | 'end'
  minWidth?: number
  role?: 'menu' | 'listbox'
}

type PanelPosition = {
  top: number
  left: number
  width: number
}

function computePosition(
  anchor: DOMRect,
  panelHeight: number,
  align: 'start' | 'end',
  minWidth: number,
): PanelPosition {
  const margin = 6
  const viewportPadding = 8
  const width = Math.max(minWidth, anchor.width)

  let left = align === 'end' ? anchor.right - width : anchor.left
  left = Math.max(
    viewportPadding,
    Math.min(left, window.innerWidth - width - viewportPadding),
  )

  const spaceBelow = window.innerHeight - anchor.bottom - margin
  const spaceAbove = anchor.top - margin
  const openAbove = spaceBelow < panelHeight && spaceAbove > spaceBelow

  let top = openAbove
    ? anchor.top - panelHeight - margin
    : anchor.bottom + margin

  top = Math.max(viewportPadding, Math.min(top, window.innerHeight - panelHeight - viewportPadding))

  return { top, left, width }
}

export function DropdownPanel({
  anchorRef,
  open,
  onClose,
  children,
  className,
  align = 'end',
  minWidth = 152,
  role = 'menu',
}: DropdownPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<PanelPosition | null>(null)

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setPosition(null)
      return
    }

    const update = () => {
      const anchor = anchorRef.current?.getBoundingClientRect()
      const panel = panelRef.current
      if (!anchor || !panel) return

      setPosition(
        computePosition(anchor, panel.offsetHeight, align, minWidth),
      )
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)

    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, anchorRef, align, minWidth])

  useEffect(() => {
    if (!open) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (panelRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onMouseDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [open, onClose, anchorRef])

  if (!open) return null

  const style: CSSProperties = position
    ? {
        position: 'fixed',
        top: position.top,
        left: position.left,
        width: position.width,
        zIndex: 50,
      }
    : {
        position: 'fixed',
        top: -9999,
        left: -9999,
        visibility: 'hidden',
        minWidth,
        zIndex: 50,
      }

  return createPortal(
    <div
      ref={panelRef}
      role={role}
      style={style}
      className={cn(
        'overflow-hidden border border-border bg-card py-1 shadow-elev',
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  )
}
