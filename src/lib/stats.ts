import type { Workout, WorkoutSet } from '../db'
import { estimated1RM } from './workouts'

type SetLike = Pick<WorkoutSet, 'type' | 'weight' | 'reps'>

/** Total kg lifted (weight × reps), ignoring warm-ups. */
export function volume(w: Workout): number {
  return w.exercises.reduce((sum, e) => sum + setsVolume(e.sets), 0)
}

function setsVolume(sets: SetLike[]): number {
  return sets.reduce((sum, set) => (set.type === 'warmup' ? sum : sum + (set.weight ?? 0) * (set.reps ?? 0)), 0)
}

/** Heaviest set by estimated 1RM, ignoring warm-ups. */
export function bestSet<T extends SetLike>(sets: T[]): T | undefined {
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

/** One exercise as performed in one workout, with its derived metrics. */
export interface Session {
  workoutId: string
  workoutName: string
  date: number
  sets: WorkoutSet[]
  /** Best estimated 1RM (Epley) among working sets. */
  e1rm: number
  maxWeight: number
  volume: number
  maxReps: number
  best?: WorkoutSet
}

/** Every finished session of an exercise, oldest first. */
export function exerciseSessions(workouts: Workout[], exerciseId: string): Session[] {
  const sessions: Session[] = []
  for (const w of workouts) {
    if (w.endedAt === null) continue
    const sets = w.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets)
    if (!sets.length) continue
    const working = sets.filter((s) => s.type !== 'warmup')
    sessions.push({
      workoutId: w.id,
      workoutName: w.name,
      date: w.startedAt,
      sets,
      e1rm: Math.max(0, ...working.map((s) => estimated1RM(s.weight ?? 0, s.reps ?? 0))),
      maxWeight: Math.max(0, ...working.map((s) => s.weight ?? 0)),
      volume: setsVolume(sets),
      maxReps: Math.max(0, ...working.map((s) => s.reps ?? 0)),
      best: bestSet(sets),
    })
  }
  return sessions.sort((a, b) => a.date - b.date)
}

export interface PersonalRecord {
  value: number
  date: number
  workoutId: string
  set?: WorkoutSet
}

export interface Records {
  e1rm?: PersonalRecord
  maxWeight?: PersonalRecord
  maxVolume?: PersonalRecord
  bestSetVolume?: PersonalRecord
  maxReps?: PersonalRecord
  /** Best weight lifted for at least N reps, N = 1..12. */
  repMaxes: { reps: number; weight: number; date: number; actualReps: number }[]
}

export function personalRecords(sessions: Session[]): Records {
  const records: Records = { repMaxes: [] }
  const better = (current: PersonalRecord | undefined, value: number) => value > 0 && (!current || value > current.value)
  const bestForReps = new Map<number, { weight: number; date: number; actualReps: number }>()

  for (const s of sessions) {
    if (better(records.maxVolume, s.volume)) records.maxVolume = { value: s.volume, date: s.date, workoutId: s.workoutId }
    for (const set of s.sets) {
      if (set.type === 'warmup') continue
      const w = set.weight ?? 0
      const r = set.reps ?? 0
      const rec = (value: number): PersonalRecord => ({ value, date: s.date, workoutId: s.workoutId, set })
      const e1 = estimated1RM(w, r)
      if (better(records.e1rm, e1)) records.e1rm = rec(e1)
      if (better(records.maxWeight, w)) records.maxWeight = rec(w)
      if (better(records.bestSetVolume, w * r)) records.bestSetVolume = rec(w * r)
      if (better(records.maxReps, r)) records.maxReps = rec(r)
      if (w > 0) {
        for (let n = 1; n <= Math.min(r, 12); n++) {
          const cur = bestForReps.get(n)
          if (!cur || w > cur.weight) bestForReps.set(n, { weight: w, date: s.date, actualReps: r })
        }
      }
    }
  }
  records.repMaxes = [...bestForReps.entries()].sort(([a], [b]) => a - b).map(([reps, v]) => ({ reps, ...v }))
  return records
}

/**
 * For each workout, how many exercises set a new best (estimated 1RM or weight)
 * compared with everything done before. First-ever sessions don't count.
 */
export function workoutPRCounts(workouts: Workout[]): Map<string, number> {
  const best = new Map<string, { e1rm: number; weight: number }>()
  const counts = new Map<string, number>()
  const finished = workouts.filter((w) => w.endedAt !== null).sort((a, b) => a.startedAt - b.startedAt)
  for (const w of finished) {
    let n = 0
    const seen = new Map<string, { e1rm: number; weight: number }>()
    for (const e of w.exercises) {
      for (const s of e.sets) {
        if (s.type === 'warmup') continue
        const cur = seen.get(e.exerciseId) ?? { e1rm: 0, weight: 0 }
        cur.e1rm = Math.max(cur.e1rm, estimated1RM(s.weight ?? 0, s.reps ?? 0))
        cur.weight = Math.max(cur.weight, s.weight ?? 0)
        seen.set(e.exerciseId, cur)
      }
    }
    for (const [id, today] of seen) {
      const prev = best.get(id)
      if (prev && (today.e1rm > prev.e1rm + 1e-9 || today.weight > prev.weight)) n++
      best.set(id, {
        e1rm: Math.max(prev?.e1rm ?? 0, today.e1rm),
        weight: Math.max(prev?.weight ?? 0, today.weight),
      })
    }
    if (n) counts.set(w.id, n)
  }
  return counts
}

/** Start of the ISO week (Monday 00:00, local time). */
export function weekStart(ts: number): number {
  const d = new Date(ts)
  const day = (d.getDay() + 6) % 7 // Monday = 0
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day).getTime()
}

/** Workouts per week for the last `weeks` weeks (oldest first), including the current one. */
export function weeklyCounts(workouts: Workout[], weeks: number, now: number): { week: number; count: number }[] {
  const current = weekStart(now)
  const starts: number[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(current)
    starts.push(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7 * i).getTime())
  }
  const counts = new Map(starts.map((s) => [s, 0]))
  for (const w of workouts) {
    if (w.endedAt === null) continue
    const ws = weekStart(w.startedAt)
    if (counts.has(ws)) counts.set(ws, counts.get(ws)! + 1)
  }
  return starts.map((week) => ({ week, count: counts.get(week)! }))
}
