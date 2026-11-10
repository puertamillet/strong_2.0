import type { Template, TemplateSet, Workout, WorkoutSet } from '../db'

/**
 * Two-sided sets, from the version where a unilateral set was one row for both sides. They are
 * stored as one set per side again: the first side rests what was the rest between sides, the
 * second side what was the rest after the set.
 */
interface TwoSided {
  sides?: 2
  sideRest?: number
  firstDone?: boolean
  second?: { weight: number | null; reps: number | null }
}

type AnySet = (WorkoutSet | TemplateSet) & TwoSided

/** The sets with each two-sided set as two sets, one per side. The same array if there were none. */
export function expandSides<S extends WorkoutSet | TemplateSet>(sets: S[]): S[] {
  if (!sets.some((s) => (s as AnySet).sides === 2)) return sets
  return sets.flatMap((s) => {
    const { sides, sideRest, firstDone, second, ...base } = s as S & TwoSided
    if (sides !== 2) return [base as S]
    const first = { ...base } as S
    const firstRest = sideRest ?? base.rest
    if (firstRest === undefined) delete first.rest
    else first.rest = firstRest
    if ('done' in base) (first as WorkoutSet).done = Boolean(base.done || firstDone)
    const other = { ...base, weight: second?.weight ?? base.weight, reps: second?.reps ?? base.reps } as S
    return [first, other]
  })
}

/** The template with one set per side, or the same object if it had no two-sided sets. */
export function expandTemplateSides(t: Template): Template {
  const exercises = t.exercises.map((e) => {
    const sets = expandSides(e.sets)
    return sets === e.sets ? e : { ...e, sets }
  })
  return exercises.some((e, i) => e !== t.exercises[i]) ? { ...t, exercises } : t
}

/** The workout with one set per side, or the same object if it had no two-sided sets. */
export function expandWorkoutSides(w: Workout): Workout {
  const exercises = w.exercises.map((e) => {
    const sets = expandSides(e.sets)
    return sets === e.sets ? e : { ...e, sets }
  })
  return exercises.some((e, i) => e !== w.exercises[i]) ? { ...w, exercises } : w
}
