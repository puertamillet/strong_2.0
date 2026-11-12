import { useSyncExternalStore } from 'react'
import type { FigureSex } from '../data/bodyFigure'
import type { Muscle } from './catalog'

/** Which body the muscles are shown on: a setting of this device, male by default. */
const KEY = 'strong2.bodyFigure'
const listeners = new Set<() => void>()
let sex = readSetting()

function readSetting(): FigureSex {
  try {
    return localStorage.getItem(KEY) === 'female' ? 'female' : 'male'
  } catch {
    return 'male'
  }
}

export function setBodyFigure(next: FigureSex): void {
  sex = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // Storage unavailable; the setting lasts until the app closes.
  }
  listeners.forEach((l) => l())
}

export function useBodyFigure(): FigureSex {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => sex,
  )
}

/** How the figure paints each region: a class from the muscles the region shows. */
export type RegionPaint = (muscles: readonly Muscle[]) => string

/** An exercise: the muscles it works most in the accent colour, the ones that also work lighter. */
export function exercisePaint(primary: readonly Muscle[], secondary: readonly Muscle[]): RegionPaint {
  return (muscles) => {
    if (muscles.some((m) => primary.includes(m))) return 'body-primary'
    return muscles.some((m) => secondary.includes(m)) ? 'body-secondary' : 'body-body'
  }
}

/** Shades for weekly sets per muscle, from the first set; 10 or more is the last one. */
export const HEAT_LEVELS = [
  { from: 1, label: '1–3' },
  { from: 4, label: '4–6' },
  { from: 7, label: '7–9' },
  { from: 10, label: '10+' },
] as const

/** 0 for no sets, else 1 to 4 (see HEAT_LEVELS). */
export function heatLevel(sets: number): number {
  return HEAT_LEVELS.filter((l) => sets >= l.from).length
}

/** Sets per muscle in shades of the accent colour; a region shows its most worked muscle. */
export function heatPaint(sets: Partial<Record<Muscle, number>>): RegionPaint {
  return (muscles) => {
    const level = Math.max(0, ...muscles.map((m) => heatLevel(sets[m] ?? 0)))
    return level ? `body-heat-${level}` : 'body-body'
  }
}
