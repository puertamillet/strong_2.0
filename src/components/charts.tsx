import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { fmtTick, niceTicks } from '../lib/chartScale'

/** Width of an element, kept in sync with resizes. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

const M = { top: 22, right: 12, bottom: 26, left: 44 }

export interface LinePoint {
  x: number
  y: number
}

interface LineChartProps {
  points: LinePoint[]
  /** What is plotted, e.g. "1RM estimado". Used for the accessible name. */
  label: string
  formatY: (v: number) => string
  formatX: (x: number) => string
  formatAxisX: (x: number) => string
  height?: number
  /** Start a new line segment when two points are further apart than this (same unit as x). */
  gapBreak?: number
}

/** Single-series line chart with a crosshair tooltip (pointer and keyboard). */
export function LineChart({ points, label, formatY, formatX, formatAxisX, height = 210, gapBreak }: LineChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const n = points.length
  const plotW = Math.max(0, width - M.left - M.right)
  const plotH = height - M.top - M.bottom

  const ys = points.map((p) => p.y)
  const { lo, hi, ticks } = niceTicks(Math.min(...ys), Math.max(...ys))
  const x0 = points[0]?.x ?? 0
  const x1 = points[n - 1]?.x ?? 1
  const sx = (x: number) => M.left + (x1 === x0 ? plotW / 2 : ((x - x0) / (x1 - x0)) * plotW)
  const sy = (y: number) => M.top + plotH - ((y - lo) / (hi - lo || 1)) * plotH

  // Break the line where there is a long pause, so a gap isn't drawn as a trend.
  const segments: LinePoint[][] = []
  points.forEach((p, i) => {
    if (i === 0 || (gapBreak && p.x - points[i - 1].x > gapBreak)) segments.push([p])
    else segments[segments.length - 1].push(p)
  })
  const pathOf = (seg: LinePoint[]) => seg.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('')
  const line = segments.filter((seg) => seg.length > 1).map(pathOf).join('')
  const area = segments
    .filter((seg) => seg.length > 1)
    .map(
      (seg) =>
        `${pathOf(seg)}L${sx(seg[seg.length - 1].x).toFixed(1)},${M.top + plotH}L${sx(seg[0].x).toFixed(1)},${M.top + plotH}Z`,
    )
    .join('')
  // Lone points between gaps get a small dot so they don't disappear.
  const lone = segments.filter((seg) => seg.length === 1).map((seg) => seg[0])

  function nearest(clientX: number, target: SVGSVGElement) {
    const rect = target.getBoundingClientRect()
    const px = clientX - rect.left
    let best = 0
    let bestD = Infinity
    points.forEach((p, i) => {
      const d = Math.abs(sx(p.x) - px)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    return best
  }

  function onPointer(e: PointerEvent<SVGSVGElement>) {
    if (n) setActive(nearest(e.clientX, e.currentTarget))
  }

  function onKey(e: KeyboardEvent<SVGSVGElement>) {
    if (!n) return
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const dir = e.key === 'ArrowLeft' ? -1 : 1
      setActive((a) => Math.min(n - 1, Math.max(0, (a ?? n - 1) + (a === null ? 0 : dir))))
    } else if (e.key === 'Escape') {
      setActive(null)
    }
  }

  const last = points[n - 1]
  const act = active !== null ? points[active] : null
  const tipLeft = act ? Math.min(Math.max(sx(act.x) - 70, 0), Math.max(0, width - 140)) : 0

  return (
    <div className="chart" ref={ref} style={{ height }}>
      {width > 0 && n > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${label}: ${n} registros, último ${formatY(last.y)} (${formatX(last.x)})`}
          tabIndex={0}
          onPointerDown={onPointer}
          onPointerMove={onPointer}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line className="chart-grid" x1={M.left} x2={width - M.right} y1={sy(t)} y2={sy(t)} />
              <text className="chart-axis" x={M.left - 8} y={sy(t)} dy="0.32em" textAnchor="end">
                {fmtTick(t)}
              </text>
            </g>
          ))}
          <text className="chart-axis" x={sx(x0)} y={height - 6} textAnchor={n > 1 ? 'start' : 'middle'}>
            {formatAxisX(x0)}
          </text>
          {n > 1 && (
            <text className="chart-axis" x={sx(x1)} y={height - 6} textAnchor="end">
              {formatAxisX(x1)}
            </text>
          )}
          {area && <path className="chart-area" d={area} />}
          {line && <path className="chart-line" d={line} />}
          {lone.map((p) => (
            <circle key={p.x} className="chart-point" cx={sx(p.x)} cy={sy(p.y)} r={2.5} />
          ))}
          {act && <line className="chart-crosshair" x1={sx(act.x)} x2={sx(act.x)} y1={M.top} y2={M.top + plotH} />}
          <circle className="chart-dot" cx={sx(last.x)} cy={sy(last.y)} r={4} />
          {act && <circle className="chart-dot" cx={sx(act.x)} cy={sy(act.y)} r={5} />}
        </svg>
      )}
      {act && (
        <div className="chart-tip" style={{ left: tipLeft }} aria-live="polite">
          <strong>{formatY(act.y)}</strong>
          <span>{formatX(act.x)}</span>
        </div>
      )}
    </div>
  )
}

interface BarDatum {
  key: number
  value: number
  /** Tooltip / accessible text, e.g. "Semana del 3 nov: 4 entrenos". */
  description: string
  /** Short axis label; only the first and last are shown. */
  axis: string
}

/** Single-series column chart: thin columns, value on the latest one, tooltip per column. */
export function ColumnChart({ data, label, height = 150 }: { data: BarDatum[]; label: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const m = { top: 20, right: 8, bottom: 24, left: 28 }
  const plotW = Math.max(0, width - m.left - m.right)
  const plotH = height - m.top - m.bottom
  const n = data.length
  const max = Math.max(1, ...data.map((d) => d.value))
  const step = max <= 4 ? 1 : max <= 8 ? 2 : Math.ceil(max / 4)
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= top; v += step) ticks.push(v)
  const band = n ? plotW / n : 0
  const bw = Math.min(24, band * 0.6)
  const sy = (v: number) => m.top + plotH - (v / top) * plotH

  const bar = (x: number, y: number, w: number, h: number) => {
    const r = Math.min(4, h, w / 2)
    return `M${x},${y + h}L${x},${y + r}Q${x},${y} ${x + r},${y}L${x + w - r},${y}Q${x + w},${y} ${x + w},${y + r}L${x + w},${y + h}Z`
  }

  const act = active !== null ? data[active] : null
  const tipCenter = active !== null ? m.left + band * active + band / 2 : 0

  return (
    <div className="chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="chart-grid" x1={m.left} x2={width - m.right} y1={sy(t)} y2={sy(t)} />
              <text className="chart-axis" x={m.left - 8} y={sy(t)} dy="0.32em" textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = m.left + band * i + band / 2
            const h = (d.value / top) * plotH
            return (
              <g key={d.key}>
                {d.value > 0 && (
                  <path className={`chart-bar ${active === i ? 'is-active' : ''}`} d={bar(cx - bw / 2, sy(d.value), bw, h)} />
                )}
                {i === n - 1 && d.value > 0 && (
                  <text className="chart-label" x={cx} y={sy(d.value) - 6} textAnchor="middle">
                    {d.value}
                  </text>
                )}
                <rect
                  className="chart-hit"
                  x={m.left + band * i}
                  y={m.top}
                  width={band}
                  height={plotH}
                  tabIndex={0}
                  role="img"
                  aria-label={d.description}
                  onPointerEnter={() => setActive(i)}
                  onPointerDown={() => setActive(i)}
                  onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                />
              </g>
            )
          })}
          {n > 0 && (
            <>
              <text className="chart-axis" x={m.left + band / 2} y={height - 6} textAnchor="start">
                {data[0].axis}
              </text>
              <text className="chart-axis" x={m.left + band * (n - 0.5)} y={height - 6} textAnchor="end">
                {data[n - 1].axis}
              </text>
            </>
          )}
        </svg>
      )}
      {act && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(tipCenter - 80, 0), Math.max(0, width - 160)) }}>
          <span>{act.description}</span>
        </div>
      )}
    </div>
  )
}
