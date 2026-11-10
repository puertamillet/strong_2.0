import { useEffect, useRef } from 'react'

const ITEM = 40

interface WheelProps {
  values: number[]
  value: number
  label: string
  format: (v: number) => string
  onChange: (v: number) => void
}

/** An iOS-style picker wheel: a list that snaps to one value in the middle band. */
function Wheel({ values, value, label, format, onChange }: WheelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const settle = useRef<number | undefined>(undefined)

  // Start on the current value; afterwards the wheel is driven by the user's scrolling.
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = Math.max(0, values.indexOf(value)) * ITEM
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onScroll() {
    window.clearTimeout(settle.current)
    settle.current = window.setTimeout(() => {
      const el = ref.current
      if (!el) return
      const i = Math.min(values.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM)))
      if (values[i] !== value) onChange(values[i])
    }, 80)
  }

  function select(i: number) {
    ref.current?.scrollTo({ top: i * ITEM, behavior: 'smooth' })
    onChange(values[i])
  }

  return (
    <div className="wheel" ref={ref} onScroll={onScroll} role="listbox" aria-label={label} tabIndex={0}
      onKeyDown={(e) => {
        const i = values.indexOf(value)
        if (e.key === 'ArrowDown' && i < values.length - 1) select(i + 1)
        if (e.key === 'ArrowUp' && i > 0) select(i - 1)
      }}
    >
      <div className="wheel-pad" />
      {values.map((v, i) => (
        <div
          key={v}
          className={`wheel-item ${v === value ? 'selected' : ''}`}
          role="option"
          aria-selected={v === value}
          onClick={() => select(i)}
        >
          {format(v)}
        </div>
      ))}
      <div className="wheel-pad" />
    </div>
  )
}

interface Props {
  seconds: number
  step: number
  max: number
  onChange: (seconds: number) => void
}

/** Minutes and seconds wheels for a rest, like the iPhone timer. */
export function DurationWheels({ seconds, step, max, onChange }: Props) {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  const minuteValues = Array.from({ length: Math.floor(max / 60) + 1 }, (_, i) => i)
  // A value off the grid (e.g. 45 s from an old timer) stays selectable.
  const secondValues = [...new Set([...Array.from({ length: 60 / step }, (_, i) => i * step), rest])].sort((a, b) => a - b)
  const set = (m: number, s: number) => onChange(Math.min(max, m * 60 + s))

  return (
    <div className="wheels">
      <Wheel values={minuteValues} value={minutes} label="Minutos" format={String} onChange={(m) => set(m, rest)} />
      <span className="wheel-unit">min</span>
      <Wheel
        values={secondValues}
        value={rest}
        label="Segundos"
        format={(v) => String(v).padStart(2, '0')}
        onChange={(s) => set(minutes, s)}
      />
      <span className="wheel-unit">s</span>
    </div>
  )
}
