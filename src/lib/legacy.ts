import type { Template, TemplateExercise, TemplateSet, Workout, WorkoutExercise, WorkoutSet } from '../db'

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

/**
 * Exercise notes from the version with two kinds: the yellow note, which carries on to the next
 * time, and a note for the day (in a template, one copied into each workout). Now there is one,
 * the yellow one, called «Nota».
 */
interface TwoNotes {
  notes?: string
}

/** The note with `extra` on a new line after it, unless it already says it. */
export function addToNote(note: string | undefined, extra: string | undefined): string | undefined {
  const text = extra?.trim()
  if (!text) return note
  const current = note?.trim()
  if (!current) return text
  return current.includes(text) ? note : `${current}\n${text}`
}

/** The exercise with its other note added to its note, or the same object if it had none. */
export function mergeNotes<E extends WorkoutExercise | TemplateExercise>(e: E): E {
  if (!('notes' in e)) return e
  const { notes, ...rest } = e as E & TwoNotes
  const next = rest as E
  const note = addToNote(next.stickyNote, notes)
  if (note) next.stickyNote = note
  return next
}

/** The template with one note per exercise, or the same object if it had no other notes. */
export function mergeTemplateNotes(t: Template): Template {
  const exercises = t.exercises.map(mergeNotes)
  return exercises.some((e, i) => e !== t.exercises[i]) ? { ...t, exercises } : t
}

/** The workout with one note per exercise, or the same object if it had no other notes. */
export function mergeWorkoutNotes(w: Workout): Workout {
  const exercises = w.exercises.map(mergeNotes)
  return exercises.some((e, i) => e !== w.exercises[i]) ? { ...w, exercises } : w
}
