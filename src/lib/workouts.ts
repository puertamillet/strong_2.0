import {
  db,
  DEFAULT_REST_SECONDS,
  emptySet,
  newId,
  type Template,
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
        // Templates define structure only; values come from the last performance (shown as placeholders).
        sets: te.sets.map((s) => emptySet(s.type)),
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

export async function addExercisesToWorkout(id: string, exerciseIds: string[]): Promise<void> {
  const exercises = await db.exercises.bulkGet(exerciseIds)
  const previous = await Promise.all(exerciseIds.map((eid) => lastPerformance(eid, id)))
  await mutateWorkout(id, (w) => {
    exerciseIds.forEach((exerciseId, i) => {
      const prev = previous[i]
      // Pre-fill with as many sets as last time (at least one), like Strong does.
      const sets: WorkoutSet[] = prev?.sets.length
        ? prev.sets.map((s) => ({ ...emptySet(s.type) }))
        : [emptySet()]
      w.exercises.push({
        exerciseId,
        restSeconds: prev?.restSeconds ?? exercises[i]?.defaultRestSeconds ?? DEFAULT_REST_SECONDS,
        sets,
      })
    })
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

/** True if the workout's exercises or set counts differ from its template. */
export function differsFromTemplate(w: Workout, t: Template): boolean {
  const done = w.exercises
    .map((e) => ({ id: e.exerciseId, n: e.sets.filter((s) => s.done).length }))
    .filter((e) => e.n > 0)
  if (done.length !== t.exercises.length) return true
  return done.some((e, i) => e.id !== t.exercises[i].exerciseId || e.n !== t.exercises[i].sets.length)
}

/** Overwrite a template with the completed sets of a workout. */
export async function updateTemplateFromWorkout(w: Workout, templateId: string): Promise<void> {
  await db.templates.update(templateId, {
    updatedAt: Date.now(),
    exercises: w.exercises
      .map((e) => ({
        exerciseId: e.exerciseId,
        restSeconds: e.restSeconds,
        sets: e.sets.filter((s) => s.done).map(({ type }) => ({ type, weight: null, reps: null })),
      }))
      .filter((e) => e.sets.length > 0),
  })
}

export async function discardWorkout(id: string): Promise<void> {
  await db.workouts.delete(id)
}

/** Save a workout's structure as a new template. */
export async function saveAsTemplate(w: Workout, name = w.name): Promise<string> {
  const template: Template = {
    id: newId(),
    name,
    updatedAt: Date.now(),
    exercises: w.exercises.map((e) => ({
      exerciseId: e.exerciseId,
      restSeconds: e.restSeconds,
      sets: e.sets.map(({ type }) => ({ type, weight: null, reps: null })),
    })),
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
