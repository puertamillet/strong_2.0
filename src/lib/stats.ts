import type { Workout } from '../db'
import { estimated1RM } from './workouts'

export function volume(w: Workout): number {
  return w.exercises.reduce(
    (sum, e) => sum + e.sets.reduce((s, set) => s + (set.type === 'warmup' ? 0 : (set.weight ?? 0) * (set.reps ?? 0)), 0),
    0,
  )
}

/** Heaviest set by estimated 1RM, ignoring warm-ups. */
export function bestSet<T extends { type: string; weight: number | null; reps: number | null }>(sets: T[]): T | undefined {
  let best: T | undefined
  let bestScore = -1
  for (const s of sets) {
    if (s.type === 'warmup') continue
    const score = estimated1RM(s.weight ?? 0, s.reps ?? 0) || (s.reps ?? 0) / 1000
    if (score > bestScore) {
      best = s
      bestScore = score
    }
  }
  return best
}
