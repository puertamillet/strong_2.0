import { useEffect, useRef, useState, type ReactNode } from 'react'
import { haptic } from '../lib/haptics'

/** How long an item is held before it lifts, and how far the finger may move meanwhile. */
const HOLD_MS = 350
const SLOP_PX = 10
/** Dragging this close to the top or bottom of the screen scrolls the page. */
const EDGE_PX = 80
const SCROLL_STEP_PX = 10

interface Props<T> {
  items: T[]
  keyOf: (item: T) => string
  /** The keys in their new order, after an item is dropped somewhere else. */
  onReorder: (keys: string[]) => void
  children: (item: T) => ReactNode
  className?: string
}

interface Drag {
  /** The item being dragged and where it would drop. */
  from: number
  to: number
  /** How far it has moved, and how far the others move to make room for it. */
  dy: number
  shift: number
}

/**
 * A list whose items are moved as on iOS: hold one until it lifts, then drag it up or down and
 * let go. A swipe still scrolls and a tap still taps. The page scrolls near the edges.
 */
export function ReorderList<T>({ items, keyOf, onReorder, children, className }: Props<T>) {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  /** The order just dropped, shown until the items come back in it. */
  const [dropped, setDropped] = useState<string[] | null>(null)
  const keys = items.map(keyOf)
  if (dropped && (dropped.join() === keys.join() || [...dropped].sort().join() !== [...keys].sort().join())) setDropped(null)
  const byKey = new Map(items.map((item) => [keyOf(item), item]))
  const shown = dropped ? dropped.map((k) => byKey.get(k)!) : items

  // The latest values for the listeners, which are added once.
  const latest = useRef({ keys: dropped ?? keys, onReorder })
  useEffect(() => {
    latest.current = { keys: dropped ?? keys, onReorder }
  })

  useEffect(() => {
    const list = ref.current
    if (!list) return
    let pending: { index: number; x: number; y: number; timer: number } | null = null
    let active: {
      from: number
      startY: number
      startScroll: number
      y: number
      centers: number[]
      shift: number
      to: number
      frame: number
    } | null = null
    let swallowClick = false
    /** When the last touch ended: the mouse events a browser makes up after a touch are ignored. */
    let touchedAt = 0

    const indexAt = (target: EventTarget | null) => {
      const item = target instanceof Element ? target.closest('[data-reorder-index]') : null
      return item && list.contains(item) ? Number(item.getAttribute('data-reorder-index')) : -1
    }

    const update = () => {
      if (!active) return
      const dy = active.y - active.startY + window.scrollY - active.startScroll
      const center = active.centers[active.from] + dy
      let to = active.from
      for (let i = 0; i < active.from; i++) {
        if (center < active.centers[i]) {
          to = i
          break
        }
      }
      if (to === active.from) {
        for (let i = active.centers.length - 1; i > active.from; i--) {
          if (center > active.centers[i]) {
            to = i
            break
          }
        }
      }
      active.to = to
      setDrag({ from: active.from, to, dy, shift: active.shift })
    }

    // Near an edge, keep scrolling while the finger stays there.
    const autoscroll = () => {
      if (!active) return
      const step = active.y < EDGE_PX ? -SCROLL_STEP_PX : active.y > window.innerHeight - EDGE_PX ? SCROLL_STEP_PX : 0
      if (step) {
        window.scrollBy(0, step)
        update()
      }
      active.frame = requestAnimationFrame(autoscroll)
    }

    const lift = (index: number, y: number) => {
      pending = null
      const nodes = [...list.querySelectorAll<HTMLElement>(':scope > [data-reorder-index]')]
      if (nodes.length < 2) return
      const rects = nodes.map((n) => n.getBoundingClientRect())
      const gap = rects[1].top - rects[0].bottom
      active = {
        from: index,
        startY: y,
        startScroll: window.scrollY,
        y,
        // Where each item is now; later the dragged one moves with the finger and the page.
        centers: rects.map((r) => r.top + r.height / 2),
        shift: rects[index].height + gap,
        to: index,
        frame: 0,
      }
      swallowClick = true
      haptic(15)
      setDrag({ from: index, to: index, dy: 0, shift: active.shift })
      active.frame = requestAnimationFrame(autoscroll)
    }

    const press = (target: EventTarget | null, x: number, y: number) => {
      const index = indexAt(target)
      if (index < 0) return
      cancel()
      pending = { index, x, y, timer: window.setTimeout(() => lift(index, y), HOLD_MS) }
    }

    const move = (x: number, y: number, e?: Event) => {
      if (active) {
        e?.preventDefault()
        active.y = y
        update()
      } else if (pending && Math.hypot(x - pending.x, y - pending.y) > SLOP_PX) {
        cancel()
      }
    }

    const release = () => {
      if (pending) cancel()
      if (!active) return
      cancelAnimationFrame(active.frame)
      const { from, to } = active
      active = null
      setDrag(null)
      if (to === from) return
      const order = [...latest.current.keys]
      const [moved] = order.splice(from, 1)
      order.splice(to, 0, moved)
      setDropped(order)
      haptic()
      latest.current.onReorder(order)
    }

    const cancel = () => {
      if (pending) window.clearTimeout(pending.timer)
      pending = null
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return cancel()
      swallowClick = false
      press(e.target, e.touches[0].clientX, e.touches[0].clientY)
    }
    const onTouchMove = (e: TouchEvent) => move(e.touches[0].clientX, e.touches[0].clientY, e)
    const onTouchEnd = (e: TouchEvent) => {
      touchedAt = Date.now()
      // After a drag, no tap: the browser makes up no click or mouse events.
      if (active) e.preventDefault()
      release()
    }
    const fromTouch = () => Date.now() - touchedAt < 1000
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || fromTouch()) return
      swallowClick = false
      press(e.target, e.clientX, e.clientY)
    }
    const onMouseMove = (e: MouseEvent) => {
      if (!fromTouch() && (pending || active)) move(e.clientX, e.clientY, e)
    }
    // A long press opens no menu, and the tap that ends a drag doesn't open the item.
    const onContextMenu = (e: Event) => {
      if (pending || active) e.preventDefault()
    }
    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return
      swallowClick = false
      e.preventDefault()
      e.stopPropagation()
    }

    list.addEventListener('touchstart', onTouchStart, { passive: true })
    list.addEventListener('touchmove', onTouchMove, { passive: false })
    list.addEventListener('touchend', onTouchEnd, { passive: false })
    list.addEventListener('touchcancel', onTouchEnd)
    list.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', release)
    list.addEventListener('contextmenu', onContextMenu)
    list.addEventListener('click', onClick, true)
    return () => {
      cancel()
      if (active) cancelAnimationFrame(active.frame)
      list.removeEventListener('touchstart', onTouchStart)
      list.removeEventListener('touchmove', onTouchMove)
      list.removeEventListener('touchend', onTouchEnd)
      list.removeEventListener('touchcancel', onTouchEnd)
      list.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', release)
      list.removeEventListener('contextmenu', onContextMenu)
      list.removeEventListener('click', onClick, true)
    }
  }, [])

  const offset = (i: number) => {
    if (!drag) return undefined
    if (i === drag.from) return `translateY(${drag.dy}px) scale(1.03)`
    if (drag.from < i && i <= drag.to) return `translateY(${-drag.shift}px)`
    if (drag.to <= i && i < drag.from) return `translateY(${drag.shift}px)`
    return undefined
  }

  return (
    <div ref={ref} className={`reorder-list ${drag ? 'reordering' : ''} ${className ?? ''}`}>
      {shown.map((item, i) => (
        <div
          key={keyOf(item)}
          data-reorder-index={i}
          className={`reorder-item ${drag?.from === i ? 'lifted' : ''}`}
          style={{ transform: offset(i) }}
        >
          {children(item)}
        </div>
      ))}
    </div>
  )
}
