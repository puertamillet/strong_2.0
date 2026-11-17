import { useSyncExternalStore } from 'react'
import type { SetKey } from './workouts'

/**
 * The exercises to film this week, as the trainer asks, and which of their sets: chosen on the
 * «Grabar esta semana» page (the Monday reminder opens it), and marked on those sets during the
 * workouts of the week. Weeks go from Monday to Sunday, and each one starts with none. Kept in this
 * phone's storage.
 */
const KEY = 'strong2.filming'

export interface FilmChoice {
  exerciseId: string
  /** The sets to film. Missing: the default one (see filmSetIndexes). */
  sets?: SetKey[]
}

interface Saved {
  /** The Monday of the week, as 2026-11-09. */
  week: string
  /** In the order they were chosen. */
  exercises: FilmChoice[]
}

const NONE: FilmChoice[] = []
const listeners = new Set<() => void>()
let saved = read()

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function read(): Saved | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (typeof value !== 'object' || value === null) return null
    const { week, exercises, exerciseIds } = value as Record<string, unknown>
    if (typeof week !== 'string') return null
    // Kept before the sets could be chosen: the exercises only, to film their default sets.
    if (!Array.isArray(exercises)) return { week, exercises: strings(exerciseIds).map((exerciseId) => ({ exerciseId })) }
    return {
      week,
      exercises: exercises.flatMap((e: unknown): FilmChoice[] => {
        if (typeof e !== 'object' || e === null) return []
        const { exerciseId, sets } = e as Record<string, unknown>
        if (typeof exerciseId !== 'string') return []
        return [Array.isArray(sets) ? { exerciseId, sets: strings(sets) } : { exerciseId }]
      }),
    }
  } catch {
    return null
  }
}

function save(exercises: FilmChoice[], now: Date): void {
  saved = { week: weekOf(now), exercises }
  try {
    localStorage.setItem(KEY, JSON.stringify(saved))
  } catch {
    // Storage unavailable; the choice lasts until the app closes.
  }
  listeners.forEach((l) => l())
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

/** The exercises chosen for the week of `now`, in the order they were chosen, with their sets. */
export function filmingThisWeek(now = new Date()): FilmChoice[] {
  return saved && saved.week === weekOf(now) ? saved.exercises : NONE
}

/** Chooses an exercise to film this week, with its default sets, or takes it out. */
export function setFilming(exerciseId: string, on: boolean, now = new Date()): void {
  const chosen = filmingThisWeek(now)
  if (on === chosen.some((c) => c.exerciseId === exerciseId)) return
  save(on ? [...chosen, { exerciseId }] : chosen.filter((c) => c.exerciseId !== exerciseId), now)
}

/** The sets of an exercise to film this week; with none, it is no longer to be filmed. */
export function setFilmSets(exerciseId: string, sets: SetKey[], now = new Date()): void {
  if (!sets.length) return setFilming(exerciseId, false, now)
  const chosen = filmingThisWeek(now)
  const choice = { exerciseId, sets }
  save(
    chosen.some((c) => c.exerciseId === exerciseId)
      ? chosen.map((c) => (c.exerciseId === exerciseId ? choice : c))
      : [...chosen, choice],
    now,
  )
}

/** The exercises to film this week, with their sets. */
export function useFilming(): FilmChoice[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    filmingThisWeek,
  )
}
