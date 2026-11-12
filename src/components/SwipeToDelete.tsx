import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { haptic } from '../lib/haptics'

interface Props {
  children: ReactNode
  /** Accessible name of the red button, e.g. "Borrar la serie 2". */
  label: string
  /** Called once the row has slid away; the row comes back (with what is there now) when it's done. */
  onDelete: () => void | Promise<void>
  /** No swiping, e.g. while its text is being edited. */
  disabled?: boolean
  className?: string
}

/** Width of the red button when the row is left open. */
const ACTION_WIDTH = 84
/** Movement before a drag counts as a swipe (or as scrolling). */
const SLOP = 10
/** Released further than this, the row stays open on its button. */
const OPEN_AT = 44
/** Released further than this share of its width (or flicked), it is deleted straight away. */
const DELETE_AT = 0.5
const FLICK = 0.5 // px/ms
const SLIDE_MS = 180

/** The row left open, which closes when another one is swiped. */
let openRow: { root: HTMLElement; close: () => void } | null = null

function closeOtherRows(root: HTMLElement | null) {
  if (openRow && openRow.root !== root) openRow.close()
}

interface Drag {
  id: number
  x: number
  y: number
  from: number
  mode: 'pending' | 'swipe' | 'scroll'
  last: { x: number; t: number }
  speed: number
  armed: boolean
}

/**
 * A row that is deleted by swiping it to the left, as in Strong and in iOS lists: a red «Borrar»
 * shows behind it as it moves; let go past half its width (or flick it) and it goes, let go a little
 * and it stays open on the button. Vertical drags still scroll. There is always another way to do
 * the same (a menu or a button), for keyboards and screen readers.
 */
export function SwipeToDelete({ children, label, onDelete, disabled, className }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const action = useRef<HTMLButtonElement>(null)
  const drag = useRef<Drag | null>(null)
  const offset = useRef(0)
  /** Until when a click is the end of a swipe, not a tap (event time, ms). */
  const swallowUntil = useRef(0)
  const [open, setOpen] = useState(false)

  function place(x: number, animate: boolean) {
    offset.current = x
    root.current?.classList.toggle('swiping', !animate)
    if (content.current) content.current.style.transform = x ? `translateX(${x}px)` : ''
    if (action.current) action.current.style.width = `${Math.max(0, -x)}px`
  }

  function forget() {
    if (openRow?.root === root.current) openRow = null
  }

  function close() {
    place(0, true)
    setOpen(false)
    forget()
  }

  function stayOpen() {
    closeOtherRows(root.current)
    if (root.current) openRow = { root: root.current, close }
    place(-ACTION_WIDTH, true)
    setOpen(true)
  }

  async function remove() {
    haptic()
    forget()
    place(-(root.current?.offsetWidth ?? 400), true)
    await new Promise((resolve) => setTimeout(resolve, SLIDE_MS))
    try {
      await onDelete()
    } finally {
      place(0, false)
      setOpen(false)
    }
  }

  // An open row closes when touching anywhere else.
  useEffect(() => {
    if (!open) return
    const onDown = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (disabled || !e.isPrimary || e.button !== 0) return
    // Not while typing in it: the drag moves the cursor.
    if (e.target === document.activeElement && (e.target as HTMLElement).matches('input, textarea')) return
    drag.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      from: offset.current,
      mode: 'pending',
      last: { x: e.clientX, t: e.timeStamp },
      speed: 0,
      armed: false,
    }
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d || d.id !== e.pointerId || d.mode === 'scroll') return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (d.mode === 'pending') {
      if (Math.abs(dy) > SLOP && Math.abs(dy) >= Math.abs(dx)) {
        d.mode = 'scroll'
        return
      }
      if (Math.abs(dx) <= SLOP || Math.abs(dx) < Math.abs(dy)) return
      // Only to the left, or back to the right when it is open.
      if (dx > 0 && d.from === 0) {
        d.mode = 'scroll'
        return
      }
      d.mode = 'swipe'
      e.currentTarget.setPointerCapture(e.pointerId)
      closeOtherRows(root.current)
    }
    const width = root.current?.offsetWidth ?? 400
    const x = Math.min(0, Math.max(-width, d.from + dx))
    const dt = e.timeStamp - d.last.t
    if (dt > 0) d.speed = (e.clientX - d.last.x) / dt
    d.last = { x: e.clientX, t: e.timeStamp }
    // A tick when letting go would delete it, as in iOS.
    const armed = -x > width * DELETE_AT
    if (armed !== d.armed) {
      d.armed = armed
      if (armed) haptic()
    }
    place(x, false)
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    if (d.mode !== 'swipe') return
    swallowUntil.current = e.timeStamp + 400
    const width = root.current?.offsetWidth ?? 400
    const x = offset.current
    if (e.type === 'pointercancel') {
      if (d.from) stayOpen()
      else close()
    } else if (-x > width * DELETE_AT || (d.speed < -FLICK && -x > OPEN_AT)) void remove()
    else if (-x > OPEN_AT && d.speed <= FLICK) stayOpen()
    else close()
  }

  // The click that may follow a swipe does nothing, and a tap on an open row only closes it.
  function onClickCapture(e: MouseEvent<HTMLDivElement>) {
    const afterSwipe = e.timeStamp < swallowUntil.current
    if (!afterSwipe && (!open || action.current?.contains(e.target as Node))) return
    e.preventDefault()
    e.stopPropagation()
    if (!afterSwipe) close()
  }

  return (
    <div
      ref={root}
      className={`swipe ${className ?? ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClickCapture={onClickCapture}
    >
      <button
        ref={action}
        className="swipe-action"
        aria-label={label}
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
        onClick={() => void remove()}
      >
        Borrar
      </button>
      <div ref={content} className="swipe-content">
        {children}
      </div>
    </div>
  )
}
