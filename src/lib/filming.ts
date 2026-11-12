import { useSyncExternalStore } from 'react'

/**
 * The exercises to film this week, as the trainer asks: chosen on the «Grabar esta semana» page
 * (the Monday reminder opens it), and marked on their set to film during the workouts of the week.
 * Weeks go from Monday to Sunday, and each one starts with none. Kept in this phone's storage.
 */
const KEY = 'strong2.filming'

interface Saved {
  /** The Monday of the week, as 2026-11-09. */
  week: string
  exerciseIds: string[]
}

const NONE: string[] = []
const listeners = new Set<() => void>()
let saved = read()

function read(): Saved | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (typeof value !== 'object' || value === null) return null
    const { week, exerciseIds } = value as Record<string, unknown>
    if (typeof week !== 'string' || !Array.isArray(exerciseIds)) return null
    return { week, exerciseIds: exerciseIds.filter((id): id is string => typeof id === 'string') }
  } catch {
    return null
  }
}

/** The Monday and the Sunday of the week of `d` (local time). */
export function weekDays(d: Date): [Date, Date] {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7))
  return [monday, new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)]
}

/** The Monday of the week of `d` (local time), as 2026-11-09. */
export function weekOf(d: Date): string {
  const [monday] = weekDays(d)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`
}

/** The exercises chosen for the week of `now`, in the order they were chosen. */
export function filmingThisWeek(now = new Date()): string[] {
  return saved && saved.week === weekOf(now) ? saved.exerciseIds : NONE
}

/** Chooses an exercise to film this week, or takes it out. */
export function setFilming(exerciseId: string, on: boolean, now = new Date()): void {
  const ids = filmingThisWeek(now).filter((id) => id !== exerciseId)
  if (on) ids.push(exerciseId)
  saved = { week: weekOf(now), exerciseIds: ids }
  try {
    localStorage.setItem(KEY, JSON.stringify(saved))
  } catch {
    // Storage unavailable; the choice lasts until the app closes.
  }
  listeners.forEach((l) => l())
}

/** The exercises to film this week. */
export function useFilming(): string[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    filmingThisWeek,
  )
}
