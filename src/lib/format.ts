import type { RepRange, SetType, WorkoutSet } from '../db'

const numFmt = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, useGrouping: false })

/** Up to two decimals with a decimal comma, e.g. 51,25 (no thousands separator, so it also works in inputs). */
export function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return ''
  return numFmt.format(n)
}

const intFmt = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 })

/** Whole number with thousands separator, e.g. 12.821 */
export function fmtInt(n: number): string {
  return intFmt.format(Math.round(n))
}

/** "60 kg × 8", or "12 reps" without weight. */
export function fmtSet(s: Pick<WorkoutSet, 'weight' | 'reps'>): string {
  if (s.weight === null && s.reps === null) return '—'
  if (!s.weight) return `${fmtNumber(s.reps)} reps`
  return `${fmtNumber(s.weight)} kg × ${fmtNumber(s.reps)}`
}

/** "6–8", or "8" for an exact target. */
export function fmtRange(r: RepRange): string {
  return r[0] === r[1] ? String(r[0]) : `${r[0]}–${r[1]}`
}

/** Reads "6-8", "6–8" or "8". Empty → null; anything else → undefined (invalid). */
export function parseRange(text: string): RepRange | null | undefined {
  const t = text.trim()
  if (!t) return null
  const m = /^(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$/.exec(t)
  if (!m) return undefined
  const a = Number(m[1])
  const b = m[2] === undefined ? a : Number(m[2])
  return a <= b ? [a, b] : [b, a]
}

/** Rest for display: "2:30", or "Sin descanso". */
export function fmtRest(seconds: number): string {
  return seconds > 0 ? fmtClock(seconds) : 'Sin descanso'
}

export function fmtDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h ? `${h} h ${m} min` : `${m} min`
}

export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

const dateFmt = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})
const shortDateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' })

export function fmtDate(ts: number): string {
  const s = dateFmt.format(ts)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function fmtShortDate(ts: number): string {
  return shortDateFmt.format(ts)
}

const mediumDateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })

/** e.g. "28 sept 2026" */
export function fmtMediumDate(ts: number): string {
  return mediumDateFmt.format(ts)
}

const dateTimeFmt = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** e.g. "10 nov 2026, 13:35" */
export function fmtDateTime(ts: number): string {
  return dateTimeFmt.format(ts)
}

/** Label shown in the "Serie" column: a letter for special sets, or the working-set number. */
export function setLabel(type: SetType, workingIndex: number): string {
  switch (type) {
    case 'warmup':
      return 'C'
    case 'top':
      return 'T'
    case 'backoff':
      return 'B'
    case 'drop':
      return 'D'
    case 'failure':
      return 'F'
    default:
      return String(workingIndex)
  }
}

/** Labels for a list of sets: working sets are numbered, the rest get a letter. */
export function setLabels(sets: { type: SetType }[]): string[] {
  let working = 0
  return sets.map((s) => setLabel(s.type, s.type === 'normal' ? ++working : working))
}

export const SET_TYPE_NAMES: Record<SetType, string> = {
  normal: 'Normal',
  warmup: 'Calentamiento',
  top: 'Top set',
  backoff: 'Back off',
  drop: 'Drop set',
  failure: 'Al fallo',
}

/** Parse a user-typed number, accepting a comma as decimal separator. */
export function parseNum(v: string): number | null {
  const t = v.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Lowercase and strip accents, for search. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}
