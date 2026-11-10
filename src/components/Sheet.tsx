import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons'

interface SheetProps {
  title?: ReactNode
  /** Header button on the left (usually close or minimise). */
  left?: ReactNode
  /** Header action on the right (save, finish, edit…). */
  right?: ReactNode
  /** Swiping the header down calls this (close or minimise). Leave it out for sheets with unsaved edits. */
  onDismiss?: () => void
  /** Stacking level: 1 for a page, 2 or more for a sheet opened on top of another. */
  level?: number
  /** Fixed content under the header that doesn't scroll (a search box, for example). */
  toolbar?: ReactNode
  footer?: ReactNode
  label?: string
  children: ReactNode
}

const DISMISS_DISTANCE = 90

/** Card that slides up over the app, with a header (X on the left, action on the right) and its own scroll. */
export function Sheet({ title, left, right, onDismiss, level = 1, toolbar, footer, label, children }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; dy: number; id: number } | null>(null)

  // Keep the page behind from scrolling while the sheet is open.
  useEffect(() => {
    const { style } = document.documentElement
    const before = style.overflow
    style.overflow = 'hidden'
    return () => {
      style.overflow = before
    }
  }, [])

  function onPointerDown(e: PointerEvent) {
    if (!onDismiss || (e.target as HTMLElement).closest('button, input, select, textarea, a')) return
    drag.current = { y: e.clientY, dy: 0, id: e.pointerId }
    e.currentTarget.setPointerCapture(e.pointerId)
    panel.current?.classList.add('dragging')
  }

  function onPointerMove(e: PointerEvent) {
    const d = drag.current
    if (!d || d.id !== e.pointerId || !panel.current) return
    d.dy = Math.max(0, e.clientY - d.y)
    panel.current.style.transform = `translateY(${d.dy}px)`
  }

  function onPointerUp(e: PointerEvent) {
    const d = drag.current
    if (!d || d.id !== e.pointerId || !panel.current) return
    drag.current = null
    panel.current.classList.remove('dragging')
    if (d.dy > DISMISS_DISTANCE) {
      onDismiss?.()
    } else {
      panel.current.style.transform = ''
    }
  }

  // Rendered at the end of <body> so a sheet opened from another one is never clipped or moved by it.
  return createPortal(
    <div className="sheet-backdrop" style={{ zIndex: 10 + level * 10 }}>
      <div className={`sheet level-${Math.min(level, 3)}`} ref={panel} role="dialog" aria-modal="true" aria-label={label}>
        <div
          className={`sheet-head ${onDismiss ? 'draggable' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {onDismiss && <span className="grabber" aria-hidden="true" />}
          <div className="sheet-bar">
            <div className="sheet-side">{left}</div>
            <div className="sheet-title">{title}</div>
            <div className="sheet-side end">{right}</div>
          </div>
          {toolbar}
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function CloseButton({ onClick, label = 'Cerrar' }: { onClick: () => void; label?: string }) {
  return (
    <button className="icon-btn" aria-label={label} onClick={onClick}>
      <Icon name="close" size={22} />
    </button>
  )
}

export function MinimizeButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="icon-btn" aria-label="Minimizar" onClick={onClick}>
      <Icon name="chevronDown" size={24} />
    </button>
  )
}
