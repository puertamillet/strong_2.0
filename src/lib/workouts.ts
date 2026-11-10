import {
  db,
  DEFAULT_REST_SECONDS,
  emptySet,
  newId,
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
    ? template.exercises.map((te) => ({
        exerciseId: te.exerciseId,
        restSeconds: te.restSeconds,
        // The template's weights and reps (last time's, kept up to date when finishing); empty ones get
        // last time's values as placeholders.
        sets: te.sets.map(fromTemplateSet),
      }))
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

/** New exercises for a workout or template, with as many sets as last time (at least one), like Strong. */
export async function newWorkoutExercises(exerciseIds: string[], excludeWorkoutId?: string): Promise<WorkoutExercise[]> {
  const exercises = await db.exercises.bulkGet(exerciseIds)
  const previous = await Promise.all(exerciseIds.map((eid) => lastPerformance(eid, excludeWorkoutId)))
  return exerciseIds.map((exerciseId, i) => {
    const prev = previous[i]
    return {
      exerciseId,
      restSeconds: prev?.restSeconds ?? exercises[i]?.defaultRestSeconds ?? DEFAULT_REST_SECONDS,
      sets: prev?.sets.length ? prev.sets.map((s) => emptySet(s.type)) : [emptySet()],
    }
  })
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
    w.exercises = w.exercises
      .map((e) => ({ ...e, sets: e.sets.filter((s) => s.done) }))
      .filter((e) => e.sets.length > 0)
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

/** Sets that went into a template: type and values, without completion state. */
export function toTemplateSet(s: WorkoutSet): TemplateSet {
  const t: TemplateSet = { type: s.type, weight: s.weight, reps: s.reps }
  if (s.seconds != null) t.seconds = s.seconds
  if (s.distance != null) t.distance = s.distance
  return t
}

export function fromTemplateSet(s: TemplateSet): WorkoutSet {
  const set: WorkoutSet = { ...emptySet(s.type), weight: s.weight ?? null, reps: s.reps ?? null }
  if (s.seconds != null) set.seconds = s.seconds
  if (s.distance != null) set.distance = s.distance
  return set
}

/**
 * True if the workout's structure differs from its template: exercises (or their order),
 * the sets of each exercise (count or type) or the rest timers. Sets left unticked still
 * count as part of the structure: skipping a set is not changing the template.
 */
export function differsFromTemplate(w: Workout, t: Template): boolean {
  if (w.exercises.length !== t.exercises.length) return true
  return w.exercises.some((e, i) => {
    const te = t.exercises[i]
    return (
      e.exerciseId !== te.exerciseId ||
      e.restSeconds !== te.restSeconds ||
      e.sets.length !== te.sets.length ||
      e.sets.some((s, j) => s.type !== te.sets[j].type)
    )
  })
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

/** The template with the weights and reps of the sets completed in the workout (same exercise, same kind of set, in order). */
export function templateWithValues(t: Template, w: Workout): Template {
  const sources = pairByExercise(t.exercises, w.exercises)
  return {
    ...t,
    exercises: t.exercises.map((te, i): TemplateExercise => {
      const we = sources[i]
      if (!we) return te
      return {
        ...te,
        sets: te.sets.map((s, j) => {
          const done = sameTypeSet(we.sets, te.sets, j)
          return done?.done ? { ...s, ...toTemplateSet(done) } : s
        }),
      }
    }),
  }
}

/** The template rebuilt from the workout: its exercises, sets and rest timers, with today's values. */
export function templateFromWorkout(t: Template, w: Workout): Template {
  return {
    ...t,
    exercises: w.exercises
      .filter((e) => e.sets.length > 0)
      .map((e) => ({ exerciseId: e.exerciseId, restSeconds: e.restSeconds, sets: e.sets.map(toTemplateSet) })),
  }
}

/**
 * After finishing a workout started from a template: the template always takes the
 * weights and reps done today; with `structure` it also takes the exercises, sets and
 * rest timers. `w` is the workout as it was before finishing (with unticked sets).
 */
export async function syncTemplate(w: Workout, templateId: string, structure: boolean): Promise<void> {
  await db.transaction('rw', db.templates, async () => {
    const t = await db.templates.get(templateId)
    if (!t) return
    const next = structure ? templateFromWorkout(t, w) : templateWithValues(t, w)
    await db.templates.put({ ...next, updatedAt: Date.now() })
  })
}

/**
 * Saves an edited past workout: like finishing, unticked sets and empty exercises are
 * dropped. Returns false if nothing is left (the workout is not saved).
 */
export async function saveWorkout(draft: Workout): Promise<boolean> {
  const exercises = draft.exercises
    .map((e) => ({ ...e, sets: e.sets.filter((s) => s.done) }))
    .filter((e) => e.sets.length > 0)
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
    exercises: w.exercises
      .filter((e) => e.sets.length > 0)
      .map((e) => ({ exerciseId: e.exerciseId, restSeconds: e.restSeconds, sets: e.sets.map(toTemplateSet) })),
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
