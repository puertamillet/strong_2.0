import { fmtInt, fmtNumber } from './format'

/** Round axis ticks: steps of 1, 2, 2.5 or 5 × 10^k. */
export function niceTicks(min: number, max: number, count = 4): { lo: number; hi: number; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { lo: 0, hi: 1, ticks: [0, 1] }
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1
    min -= pad
    max += pad
  }
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000)
  return { lo, hi, ticks }
}

/** Axis for columns that start at zero: round ticks, and whole steps for counts. */
export function columnTicks(max: number, counts: boolean): { top: number; ticks: number[] } {
  const nice = niceTicks(0, max > 0 ? max : 1)
  const step = nice.ticks[1] - nice.ticks[0]
  if (!counts || Number.isInteger(step)) return { top: nice.hi, ticks: nice.ticks }
  const whole = Math.ceil(step)
  const top = Math.ceil(Math.max(max, 1) / whole) * whole
  const ticks: number[] = []
  for (let v = 0; v <= top; v += whole) ticks.push(v)
  return { top, ticks }
}

export function fmtTick(v: number): string {
  if (Math.abs(v) >= 10_000) return `${fmtNumber(Math.round(v / 100) / 10)}K`
  return Number.isInteger(v) ? fmtInt(v) : fmtNumber(v)
}
