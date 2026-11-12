import {
  db,
  DEFAULT_REST_SECONDS,
  emptySet,
  newId,
  restAfter,
  type RepRange,
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

/** An empty set like `s`: same kind, rests, target reps and mark to film it, no values. */
function setShape(s: WorkoutSet | TemplateSet): WorkoutSet {
  const set = emptySet(s.type)
  if (s.rest !== undefined) set.rest = s.rest
  if (s.range) set.range = s.range
  if (s.film) set.film = true
  return set
}

/** The set added by "Añadir serie": like the last one (after a top set or back off, another back off), not to film. */
export function nextSet(we: WorkoutExercise): WorkoutSet {
  const last = we.sets[we.sets.length - 1]
  if (!last) return emptySet()
  const type: SetType = last.type === 'top' || last.type === 'backoff' ? 'backoff' : last.type === 'warmup' ? 'normal' : last.type
  const { film: _film, ...shape } = setShape(last)
  return { ...shape, type }
}

/**
 * The set to film of an exercise chosen to be filmed that week: the one marked in the template,
 * else the first that is not a warm-up. -1 if it has no sets.
 */
export function filmSetIndex(sets: Pick<WorkoutSet, 'type' | 'film'>[]): number {
  const marked = sets.findIndex((s) => s.film)
  if (marked >= 0) return marked
  const working = sets.findIndex((s) => s.type !== 'warmup')
  return working >= 0 ? working : sets.length ? 0 : -1
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
  /** The sets of the last sessions with weights and reps, oldest first (up to STALL_SESSIONS). */
  recent: WorkoutSet[][]
  /** Sessions in a row, up to the last one, that did not improve (see stalledSessions). */
  stalled: number
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
  // Each session's sets that count for progress; the same exercise twice in a workout is one session.
  const sessions = earlier
    .map((w) => w.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets.filter(counts)))
    .filter((sets) => sets.length > 0)
  return {
    last: latest?.exercises.find((e) => e.exerciseId === exerciseId),
    bestE1rm,
    bestWeight,
    sessions: earlier.length,
    recent: sessions.slice(-STALL_SESSIONS),
    stalled: stalledSessions(sessions),
  }
}

/** Kinds of set that make up the work (not warm-ups, drops or sets to failure). */
export const WORKING_SETS: ReadonlySet<SetType> = new Set(['normal', 'top', 'backoff'])

/**
 * For each set, the same set in another session: the same kind of set in the same order; for a
 * working set, else the working set in the same position (a top set after sets logged as normal,
 * as in Strong).
 */
export function sameSets(sets: WorkoutSet[], other: WorkoutSet[]): (WorkoutSet | undefined)[] {
  const byType = new Map<SetType, WorkoutSet[]>()
  for (const s of other) byType.set(s.type, [...(byType.get(s.type) ?? []), s])
  const working = other.filter((s) => WORKING_SETS.has(s.type))
  const seen = new Map<SetType, number>()
  let position = 0
  return sets.map((s) => {
    const n = seen.get(s.type) ?? 0
    seen.set(s.type, n + 1)
    const at = WORKING_SETS.has(s.type) ? position++ : -1
    return byType.get(s.type)?.[n] ?? (at >= 0 && !byType.has(s.type) ? working[at] : undefined)
  })
}

/** Sessions in a row without improving that make an exercise stalled, and how far back each one looks. */
export const STALL_SESSIONS = 4

/** A done set with reps that is not a warm-up: the sets that show progress. */
function counts(s: WorkoutSet): boolean {
  return s.done && s.type !== 'warmup' && (s.reps ?? 0) > 0
}

/**
 * True if some set beats the same set in each of the sessions before: more weight or more reps
 * than each of them (more weight with fewer reps counts too). A set that was not done before
 * doesn't count.
 */
export function improves(sets: WorkoutSet[], before: WorkoutSet[][]): boolean {
  const same = before.map((other) => sameSets(sets, other))
  return sets.some((s, i) => {
    if (!counts(s)) return false
    const earlier = same.map((m) => m[i]).filter((o): o is WorkoutSet => o !== undefined)
    const [w, r] = [s.weight ?? 0, s.reps ?? 0]
    return earlier.length > 0 && earlier.every((o) => (o.weight ?? 0) < w - 1e-9 || (o.reps ?? 0) < r)
  })
}

/** How many sessions in a row, up to the last, did not improve on the STALL_SESSIONS before each. */
export function stalledSessions(sessions: WorkoutSet[][]): number {
  let streak = 0
  for (let k = sessions.length - 1; k >= 1; k--) {
    if (improves(sessions[k], sessions.slice(Math.max(0, k - STALL_SESSIONS), k))) break
    streak++
  }
  return streak
}

/**
 * Stalled: the last STALL_SESSIONS sessions did not improve, nor has this workout so far. Returns
 * how many sessions it has been, or 0.
 */
export function stalledFor(sets: WorkoutSet[], ctx: ExerciseContext | undefined): number {
  if (!ctx || ctx.stalled < STALL_SESSIONS || improves(sets, ctx.recent)) return 0
  return ctx.stalled
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

/** The note of `we` set on `te` (or removed, if `we` has none). */
function withStickyNote(te: TemplateExercise, we: WorkoutExercise): TemplateExercise {
  const next = { ...te }
  if (we.stickyNote) next.stickyNote = we.stickyNote
  else delete next.stickyNote
  return next
}

/**
 * The template with the values of the sets completed in the workout (same exercise, same kind
 * of set, in order) and the notes as they are now. Rests and target reps stay as they were.
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
 * date when finishing; empty ones get last time's values as placeholders), rests, targets and note.
 */
export function fromTemplateExercise(te: TemplateExercise): WorkoutExercise {
  const we: WorkoutExercise = { exerciseId: te.exerciseId, restSeconds: te.restSeconds, sets: te.sets.map(fromTemplateSet) }
  if (te.stickyNote) we.stickyNote = te.stickyNote
  return we
}

/** A template exercise made from a workout exercise: its sets, rests and note. */
export function templateExercise(e: WorkoutExercise): TemplateExercise {
  const te: TemplateExercise = { exerciseId: e.exerciseId, restSeconds: e.restSeconds, sets: e.sets.map(toTemplateSet) }
  if (e.stickyNote) te.stickyNote = e.stickyNote
  return te
}

/** The template rebuilt from the workout: its exercises, sets, rests and notes, with today's values. */
export function templateFromWorkout(t: Template, w: Workout): Template {
  return { ...t, exercises: w.exercises.filter((e) => e.sets.length > 0).map((e) => templateExercise(e)) }
}

/**
 * What finishing a workout would change in its template, as Strong tells before updating it.
 * `w` is the workout as it was before finishing: sets left unticked still count as part of the
 * structure, because skipping a set is not changing the template.
 */
export interface TemplateChanges {
  /** Template sets whose weight or reps would take today's values. */
  values: number
  /** Notes changed during the workout. */
  notes: number
  addedExercises: number
  removedExercises: number
  addedSets: number
  removedSets: number
  /** Sets of another kind (e.g. a normal set made a top set). */
  setTypes: number
  rests: boolean
  /** Target reps changed (e.g. 6-8 made 8-10). */
  ranges: boolean
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
    ranges: false,
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
    const { added, removed, pairs } = alignSets(te, we)
    c.addedSets += added
    c.removedSets += removed
    for (const [ts, s] of pairs) {
      if (s.type !== ts.type) c.setTypes++
      if (restAfter(s, we) !== restAfter(ts, te)) c.rests = true
      if (!sameRange(s.range, ts.range)) c.ranges = true
    }
  })
  return c
}

/**
 * The template's sets paired with the workout's by the fewest changes that turn one into the other
 * (a set removed, added or of another kind) and, among those, keeping the most rests and targets:
 * deleting the first warm-up is one set less, not every set below it changing.
 */
function alignSets(te: TemplateExercise, we: WorkoutExercise): { added: number; removed: number; pairs: [TemplateSet, WorkoutSet][] } {
  const t = te.sets
  const w = we.sets
  /** A set added, removed or of another kind; a different rest or target costs 1. */
  const STEP = 100
  const cost = (a: TemplateSet, b: WorkoutSet) =>
    (a.type === b.type ? 0 : STEP) + (restAfter(a, te) === restAfter(b, we) ? 0 : 1) + (sameRange(a.range, b.range) ? 0 : 1)
  // d[i][j]: the cheapest way to turn the first i template sets into the first j of the workout.
  const d = t.map(() => new Array<number>(w.length + 1).fill(0))
  d.push(new Array<number>(w.length + 1).fill(0))
  for (let i = 0; i <= t.length; i++) {
    for (let j = 0; j <= w.length; j++) {
      if (i === 0 || j === 0) d[i][j] = (i + j) * STEP
      else d[i][j] = Math.min(d[i - 1][j] + STEP, d[i][j - 1] + STEP, d[i - 1][j - 1] + cost(t[i - 1], w[j - 1]))
    }
  }
  const pairs: [TemplateSet, WorkoutSet][] = []
  let added = 0
  let removed = 0
  let i = t.length
  let j = w.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + cost(t[i - 1], w[j - 1])) {
      pairs.push([t[--i], w[--j]])
    } else if (i > 0 && d[i][j] === d[i - 1][j] + STEP) {
      removed++
      i--
    } else {
      added++
      j--
    }
  }
  return { added, removed, pairs: pairs.reverse() }
}

function sameRange(a: RepRange | undefined, b: RepRange | undefined): boolean {
  return (a?.[0] ?? null) === (b?.[0] ?? null) && (a?.[1] ?? null) === (b?.[1] ?? null)
}

/** True if the exercises, sets, rests or target reps differ: updating the template would change its structure. */
export function structureChanged(c: TemplateChanges): boolean {
  return Boolean(
    c.addedExercises || c.removedExercises || c.addedSets || c.removedSets || c.setTypes || c.rests || c.ranges || c.order,
  )
}

/** True if today's values or notes differ from the template's. */
export function valuesChanged(c: TemplateChanges): boolean {
  return c.values > 0 || c.notes > 0
}

/**
 * After finishing a workout started from a template, as chosen in the dialog: `values` takes
 * the weights, reps and notes of today; `all` also takes the exercises, sets and rests.
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
