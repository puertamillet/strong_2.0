import {
  db,
  DEFAULT_REST_SECONDS,
  emptySet,
  newId,
  restAfter,
  type SetType,
  type Template,
  type TemplateExercise,
  type TemplateSet,
  type Workout,
  type WorkoutExercise,
  type WorkoutSet,
} from '../db'

/** The in-progress workout, if any. It is always the most recently started one. */
export async function getActiveWorkout(): Promise<Workout | undefined> {
  const last = await db.workouts.orderBy('startedAt').last()
  return last && last.endedAt === null ? last : undefined
}

export async function startWorkout(template?: Template): Promise<string> {
  const active = await getActiveWorkout()
  if (active) return active.id
  const exercises: WorkoutExercise[] = template
    ? template.exercises.map(fromTemplateExercise)
    : []
  const workout: Workout = {
    id: newId(),
    name: template?.name ?? defaultWorkoutName(new Date()),
    startedAt: Date.now(),
    endedAt: null,
    templateId: template?.id,
    source: 'app',
    exercises,
    exerciseIds: exercises.map((e) => e.exerciseId),
  }
  await db.workouts.add(workout)
  return workout.id
}

export function defaultWorkoutName(d: Date): string {
  const h = d.getHours()
  if (h < 12) return 'Entreno de mañana'
  if (h < 20) return 'Entreno de tarde'
  return 'Entreno de noche'
}

/** Read-modify-write a workout atomically. */
export async function mutateWorkout(id: string, fn: (w: Workout) => void): Promise<void> {
  await db.transaction('rw', db.workouts, async () => {
    const w = await db.workouts.get(id)
    if (!w) return
    fn(w)
    w.exerciseIds = [...new Set(w.exercises.map((e) => e.exerciseId))]
    await db.workouts.put(w)
  })
}

/**
 * New exercises for a workout or template, like Strong: as many sets as last time (at least one),
 * with last time's kinds of set, rests, target reps and sticky note.
 */
export async function newWorkoutExercises(exerciseIds: string[], excludeWorkoutId?: string): Promise<WorkoutExercise[]> {
  const exercises = await db.exercises.bulkGet(exerciseIds)
  const previous = await Promise.all(exerciseIds.map((eid) => lastPerformance(eid, excludeWorkoutId)))
  return exerciseIds.map((exerciseId, i) => {
    const prev = previous[i]
    const we: WorkoutExercise = {
      exerciseId,
      restSeconds: prev?.restSeconds ?? exercises[i]?.defaultRestSeconds ?? DEFAULT_REST_SECONDS,
      sets: prev?.sets.length ? prev.sets.map(setShape) : [emptySet()],
    }
    if (prev?.stickyNote) we.stickyNote = prev.stickyNote
    return we
  })
}

/** An empty set like `s`: same kind, rests and target reps, no values. */
function setShape(s: WorkoutSet | TemplateSet): WorkoutSet {
  const set = emptySet(s.type)
  if (s.rest !== undefined) set.rest = s.rest
  if (s.range) set.range = s.range
  return set
}

/** The set added by "Añadir serie": like the last one (after a top set or back off, another back off). */
export function nextSet(we: WorkoutExercise): WorkoutSet {
  const last = we.sets[we.sets.length - 1]
  if (!last) return emptySet()
  const type: SetType = last.type === 'top' || last.type === 'backoff' ? 'backoff' : last.type === 'warmup' ? 'normal' : last.type
  return { ...setShape(last), type }
}

export async function addExercisesToWorkout(id: string, exerciseIds: string[]): Promise<void> {
  const added = await newWorkoutExercises(exerciseIds, id)
  await mutateWorkout(id, (w) => {
    w.exercises.push(...added)
  })
}

/** The most recent finished performance of an exercise, excluding a given workout. */
export async function lastPerformance(
  exerciseId: string,
  excludeWorkoutId?: string,
): Promise<WorkoutExercise | undefined> {
  const workouts = await db.workouts.where('exerciseIds').equals(exerciseId).toArray()
  const latest = workouts
    .filter((w) => w.endedAt !== null && w.id !== excludeWorkoutId)
    .sort((a, b) => b.startedAt - a.startedAt)[0]
  return latest?.exercises.find((e) => e.exerciseId === exerciseId)
}

export interface ExerciseContext {
  /** The previous session of this exercise (before the given time). */
  last?: WorkoutExercise
  /** Best estimated 1RM and heaviest weight before the given time. */
  bestE1rm: number
  bestWeight: number
  /** Earlier sessions; 0 means this is the first time. */
  sessions: number
}

/** What came before a workout for one exercise: last session and best marks (for "Anterior" and PRs). */
export async function exerciseContext(exerciseId: string, workoutId: string, before: number): Promise<ExerciseContext> {
  const earlier = (await db.workouts.where('exerciseIds').equals(exerciseId).toArray())
    .filter((w) => w.endedAt !== null && w.id !== workoutId && w.startedAt < before)
    .sort((a, b) => a.startedAt - b.startedAt)
  let bestE1rm = 0
  let bestWeight = 0
  for (const w of earlier) {
    for (const e of w.exercises) {
      if (e.exerciseId !== exerciseId) continue
      for (const s of e.sets) {
        if (s.type === 'warmup') continue
        bestE1rm = Math.max(bestE1rm, estimated1RM(s.weight ?? 0, s.reps ?? 0))
        bestWeight = Math.max(bestWeight, s.weight ?? 0)
      }
    }
  }
  const latest = earlier[earlier.length - 1]
  return {
    last: latest?.exercises.find((e) => e.exerciseId === exerciseId),
    bestE1rm,
    bestWeight,
    sessions: earlier.length,
  }
}

/** True if a completed set beats every earlier session (estimated 1RM or weight). */
export function isPR(set: WorkoutSet, ctx: ExerciseContext | undefined): boolean {
  if (!ctx || ctx.sessions === 0 || !set.done || set.type === 'warmup') return false
  const w = set.weight ?? 0
  const r = set.reps ?? 0
  if (w <= 0 || r <= 0) return false
  return estimated1RM(w, r) > ctx.bestE1rm + 1e-9 || w > ctx.bestWeight
}

/** Number of completed sets in a workout. */
export function countDoneSets(w: Workout): number {
  return w.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0)
}

/**
 * Finish a workout (or save an edited past one): drop sets that were not completed
 * and exercises left empty. Returns false (and deletes the workout) if nothing was
 * completed.
 */
export async function finishWorkout(id: string): Promise<boolean> {
  let kept = true
  await db.transaction('rw', db.workouts, async () => {
    const w = await db.workouts.get(id)
    if (!w) return
    w.exercises = w.exercises.map((e) => ({ ...e, sets: e.sets.filter((s) => s.done) })).filter((e) => e.sets.length > 0)
    if (w.exercises.length === 0) {
      kept = false
      await db.workouts.delete(id)
      return
    }
    w.exerciseIds = [...new Set(w.exercises.map((e) => e.exerciseId))]
    if (w.endedAt === null) w.endedAt = Date.now()
    await db.workouts.put(w)
  })
  return kept
}

type SetValues = Pick<TemplateSet, 'weight' | 'reps' | 'seconds' | 'distance'>

/** The values of a set (what was lifted), without its kind, rests or target. */
function valuesOf(s: WorkoutSet | TemplateSet): SetValues {
  const v: SetValues = { weight: s.weight, reps: s.reps }
  if (s.seconds != null) v.seconds = s.seconds
  if (s.distance != null) v.distance = s.distance
  return v
}

function sameValues(a: SetValues, b: SetValues): boolean {
  return (
    a.weight === b.weight &&
    a.reps === b.reps &&
    (a.seconds ?? null) === (b.seconds ?? null) &&
    (a.distance ?? null) === (b.distance ?? null)
  )
}

/** Sets that went into a template: kind, values, rests and target reps, without completion state. */
export function toTemplateSet(s: WorkoutSet): TemplateSet {
  return { ...setShapeOf(s), ...valuesOf(s) }
}

export function fromTemplateSet(s: TemplateSet): WorkoutSet {
  return { ...setShape(s), ...valuesOf(s) }
}

function setShapeOf(s: WorkoutSet): TemplateSet {
  const { done: _done, rpe: _rpe, ...shape } = setShape(s)
  return shape
}

/** Pairs each item of `a` with the item of `b` for the same exercise and occurrence (the 2nd bench press with the 2nd). */
function pairByExercise<A extends { exerciseId: string }, B extends { exerciseId: string }>(a: A[], b: B[]): (B | undefined)[] {
  const pools = new Map<string, B[]>()
  for (const item of b) pools.set(item.exerciseId, [...(pools.get(item.exerciseId) ?? []), item])
  return a.map((item) => pools.get(item.exerciseId)?.shift())
}

/** The set of `sets` with the same type and position among its type as `sets[index]` in `like`. */
function sameTypeSet<T extends { type: SetType }>(sets: T[] | undefined, like: { type: SetType }[], index: number): T | undefined {
  const type = like[index].type
  const n = like.slice(0, index).filter((s) => s.type === type).length
  return sets?.filter((s) => s.type === type)[n]
}

/** The sticky note of `we` set on `te` (or removed, if `we` has none). */
function withStickyNote(te: TemplateExercise, we: WorkoutExercise): TemplateExercise {
  const next = { ...te }
  if (we.stickyNote) next.stickyNote = we.stickyNote
  else delete next.stickyNote
  return next
}

/**
 * The template with the values of the sets completed in the workout (same exercise, same kind
 * of set, in order) and the sticky notes as they are now. Rests and target reps stay as they were.
 */
export function templateWithValues(t: Template, w: Workout): Template {
  const sources = pairByExercise(t.exercises, w.exercises)
  return {
    ...t,
    exercises: t.exercises.map((te, i): TemplateExercise => {
      const we = sources[i]
      if (!we) return te
      return {
        ...withStickyNote(te, we),
        sets: te.sets.map((s, j) => {
          const done = sameTypeSet(we.sets, te.sets, j)
          return done?.done ? { ...s, ...valuesOf(done) } : s
        }),
      }
    }),
  }
}

/**
 * A template's exercise as a workout's: the template's weights and reps (last time's, kept up to
 * date when finishing; empty ones get last time's values as placeholders), rests, targets and notes.
 */
export function fromTemplateExercise(te: TemplateExercise): WorkoutExercise {
  const we: WorkoutExercise = { exerciseId: te.exerciseId, restSeconds: te.restSeconds, sets: te.sets.map(fromTemplateSet) }
  if (te.stickyNote) we.stickyNote = te.stickyNote
  if (te.notes) we.notes = te.notes
  return we
}

/** A template exercise made from a workout exercise: its sets, rests and sticky note (and `notes`, if given). */
export function templateExercise(e: WorkoutExercise, notes?: string): TemplateExercise {
  const te: TemplateExercise = { exerciseId: e.exerciseId, restSeconds: e.restSeconds, sets: e.sets.map(toTemplateSet) }
  if (e.stickyNote) te.stickyNote = e.stickyNote
  if (notes) te.notes = notes
  return te
}

/**
 * The template rebuilt from the workout: its exercises, sets and rests, with today's values.
 * The template's own notes stay with their exercises (today's notes are not template notes).
 */
export function templateFromWorkout(t: Template, w: Workout): Template {
  const exercises = w.exercises.filter((e) => e.sets.length > 0)
  const before = pairByExercise(exercises, t.exercises)
  return { ...t, exercises: exercises.map((e, i) => templateExercise(e, before[i]?.notes)) }
}

/**
 * What finishing a workout would change in its template, as Strong tells before updating it.
 * `w` is the workout as it was before finishing: sets left unticked still count as part of the
 * structure, because skipping a set is not changing the template.
 */
export interface TemplateChanges {
  /** Template sets whose weight or reps would take today's values. */
  values: number
  /** Sticky notes changed during the workout. */
  notes: number
  addedExercises: number
  removedExercises: number
  addedSets: number
  removedSets: number
  /** Sets of another kind (e.g. a normal set made a top set). */
  setTypes: number
  rests: boolean
  order: boolean
}

export function templateChanges(w: Workout, t: Template): TemplateChanges {
  const c: TemplateChanges = {
    values: 0,
    notes: 0,
    addedExercises: 0,
    removedExercises: 0,
    addedSets: 0,
    removedSets: 0,
    setTypes: 0,
    rests: false,
    order: false,
  }
  // Values: the template's sets that take today's values (see templateWithValues).
  const sources = pairByExercise(t.exercises, w.exercises)
  t.exercises.forEach((te, i) => {
    const we = sources[i]
    if (!we) return
    if ((we.stickyNote ?? '') !== (te.stickyNote ?? '')) c.notes++
    te.sets.forEach((s, j) => {
      const done = sameTypeSet(we.sets, te.sets, j)
      if (done?.done && !sameValues(valuesOf(done), valuesOf(s))) c.values++
    })
  })
  // Structure: exercises, their order, their sets and rests.
  const matches = pairByExercise(w.exercises, t.exercises)
  const positions = matches.flatMap((te) => (te ? [t.exercises.indexOf(te)] : []))
  c.addedExercises = matches.filter((te) => !te).length
  c.removedExercises = t.exercises.length - positions.length
  c.order = positions.some((p, i) => i > 0 && p < positions[i - 1])
  w.exercises.forEach((we, i) => {
    const te = matches[i]
    if (!te) return
    c.addedSets += Math.max(0, we.sets.length - te.sets.length)
    c.removedSets += Math.max(0, te.sets.length - we.sets.length)
    we.sets.slice(0, te.sets.length).forEach((s, j) => {
      const ts = te.sets[j]
      if (s.type !== ts.type) c.setTypes++
      if (restAfter(s, we) !== restAfter(ts, te)) c.rests = true
    })
  })
  return c
}

/** True if the exercises, sets or rests differ: updating the template would change its structure. */
export function structureChanged(c: TemplateChanges): boolean {
  return Boolean(c.addedExercises || c.removedExercises || c.addedSets || c.removedSets || c.setTypes || c.rests || c.order)
}

/** True if today's values or sticky notes differ from the template's. */
export function valuesChanged(c: TemplateChanges): boolean {
  return c.values > 0 || c.notes > 0
}

/**
 * After finishing a workout started from a template, as chosen in the dialog: `values` takes
 * the weights, reps and sticky notes of today; `all` also takes the exercises, sets and rests.
 * `w` is the workout as it was before finishing (with unticked sets).
 */
export async function syncTemplate(w: Workout, templateId: string, what: 'values' | 'all'): Promise<void> {
  await db.transaction('rw', db.templates, async () => {
    const t = await db.templates.get(templateId)
    if (!t) return
    const next = what === 'all' ? templateFromWorkout(t, w) : templateWithValues(t, w)
    await db.templates.put({ ...next, updatedAt: Date.now() })
  })
}

/**
 * Saves an edited past workout: like finishing, unticked sets and empty exercises are
 * dropped. Returns false if nothing is left (the workout is not saved).
 */
export async function saveWorkout(draft: Workout): Promise<boolean> {
  const exercises = draft.exercises.map((e) => ({ ...e, sets: e.sets.filter((s) => s.done) })).filter((e) => e.sets.length > 0)
  if (exercises.length === 0) return false
  await db.workouts.put({ ...draft, exercises, exerciseIds: [...new Set(exercises.map((e) => e.exerciseId))] })
  return true
}

export async function discardWorkout(id: string): Promise<void> {
  await db.workouts.delete(id)
}

/** Save a workout as a new template, with its weights and reps. */
export async function saveAsTemplate(w: Workout, name = w.name): Promise<string> {
  const template: Template = {
    id: newId(),
    name,
    updatedAt: Date.now(),
    exercises: w.exercises.filter((e) => e.sets.length > 0).map((e) => templateExercise(e)),
  }
  await db.templates.add(template)
  return template.id
}

/** Epley estimated one-rep max. */
export function estimated1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0
  if (reps === 1) return weight
  return weight * (1 + reps / 30)
}
