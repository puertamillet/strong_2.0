import Dexie, { type EntityTable } from 'dexie'
import type { Equipment, Laterality, Muscle } from './lib/catalog'
import { expandTemplateSides, expandWorkoutSides } from './lib/legacy'
import { migrateToCatalog } from './lib/migrations'

/** Kinds of set. A top set is the first, heavier working set; the back off sets after it are lighter. */
export type SetType = 'normal' | 'warmup' | 'top' | 'backoff' | 'drop' | 'failure'

/** Target reps for a set, e.g. [6, 8]; [8, 8] is exactly 8. */
export type RepRange = [number, number]

export interface WorkoutSet {
  type: SetType
  weight: number | null
  reps: number | null
  /** Duration in seconds, for timed exercises. */
  seconds?: number | null
  /** Distance in km, for cardio. */
  distance?: number | null
  rpe?: number | null
  done: boolean
  /** Rest after this set, in seconds (0 = none). Missing: the exercise's `restSeconds`. */
  rest?: number
  /** Target reps, from the template. */
  range?: RepRange
}

export interface WorkoutExercise {
  exerciseId: string
  /** Notes for this exercise on this day. */
  notes?: string
  /** Yellow note always shown with the exercise (machine settings, cues); it belongs to the template. */
  stickyNote?: string
  /** Rest for sets without their own, in seconds. */
  restSeconds: number
  sets: WorkoutSet[]
}

export interface Workout {
  id: string
  name: string
  startedAt: number
  /** Null while the workout is in progress. */
  endedAt: number | null
  notes?: string
  templateId?: string
  /** Where the workout came from: logged in this app or imported from Strong. */
  source: 'app' | 'strong'
  exercises: WorkoutExercise[]
  /** Denormalised for indexed lookups by exercise. */
  exerciseIds: string[]
}

/**
 * An exercise. Name, equipment and laterality identify it: "Press de banca" with a barbell and with
 * dumbbells are two exercises. Exercises made before the catalog may lack the classification.
 */
export interface Exercise {
  id: string
  /** Name in Spanish, without the equipment, e.g. "Press de banca". */
  name: string
  equipment?: Equipment
  /** Unilateral exercises are done one side at a time. Missing: taken from the catalog by name. */
  laterality?: Laterality
  /** The muscles it works most. The only ones shown in lists, filters and stats. */
  primary?: Muscle[]
  /** Muscles that also work, shown only on the exercise's page. Empty: none. */
  secondary?: Muscle[]
  /** Its names in Strong, so imports find it. */
  strongNames?: string[]
  notes?: string
  defaultRestSeconds?: number
  createdAt: number
}

/** A set in a template: its kind, the weight and reps to do (null = take last time's), rests and target reps. */
export type TemplateSet = Pick<WorkoutSet, 'type' | 'weight' | 'reps' | 'seconds' | 'distance' | 'rest' | 'range'>

export interface TemplateExercise {
  exerciseId: string
  restSeconds: number
  sets: TemplateSet[]
  /** Yellow note, always shown with the exercise. */
  stickyNote?: string
  /** Note copied into the exercise each time the template is started. */
  notes?: string
}

export interface Template {
  id: string
  name: string
  notes?: string
  exercises: TemplateExercise[]
  updatedAt: number
}

export const db = new Dexie('strong2') as Dexie & {
  exercises: EntityTable<Exercise, 'id'>
  workouts: EntityTable<Workout, 'id'>
  templates: EntityTable<Template, 'id'>
}

const STORES = {
  exercises: 'id, &name',
  workouts: 'id, startedAt, templateId, *exerciseIds',
  templates: 'id, name, updatedAt',
}

db.version(1).stores(STORES)

// Version 2: unilateral exercises are one set per side again (see lib/legacy).
db.version(2)
  .stores(STORES)
  .upgrade(async (tx) => {
    const templates = (await tx.table<Template, string>('templates').toArray()).flatMap((t) => {
      const next = expandTemplateSides(t)
      return next === t ? [] : [next]
    })
    const workouts = (await tx.table<Workout, string>('workouts').toArray()).flatMap((w) => {
      const next = expandWorkoutSides(w)
      return next === w ? [] : [next]
    })
    await tx.table('templates').bulkPut(templates)
    await tx.table('workouts').bulkPut(workouts)
  })

// Version 3: exercises in Spanish with the catalog's data. Names are no longer unique
// ("Press de banca" with a barbell or with dumbbells), see lib/migrations.
db.version(3)
  .stores({ exercises: 'id, name' })
  .upgrade(async (tx) => {
    const exercises = tx.table<Exercise, string>('exercises')
    const workouts = tx.table<Workout, string>('workouts')
    const templates = tx.table<Template, string>('templates')
    const before = { exercises: await exercises.toArray(), workouts: await workouts.toArray(), templates: await templates.toArray() }
    const after = migrateToCatalog(before)
    await exercises.clear()
    await exercises.bulkAdd(after.exercises)
    await workouts.bulkPut(after.workouts.filter((w, i) => w !== before.workouts[i]))
    await templates.bulkPut(after.templates.filter((t, i) => t !== before.templates[i]))
  })

export const DEFAULT_REST_SECONDS = 120

/** Choices offered for rest timers, in seconds (0 = no timer). */
export const REST_OPTIONS = [0, 30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300]

/** The rest pickers go in steps of this many seconds, up to REST_MAX. */
export const REST_PICKER_STEP = 10
export const REST_MAX = 10 * 60

export function newId(): string {
  return crypto.randomUUID()
}

export function emptySet(type: SetType = 'normal'): WorkoutSet {
  return { type, weight: null, reps: null, done: false }
}

/** Seconds of rest after a set. */
export function restAfter(set: Pick<WorkoutSet, 'rest'>, exercise: Pick<WorkoutExercise, 'restSeconds'>): number {
  return set.rest ?? exercise.restSeconds
}

/** Ask the browser to keep our data (reduces the risk of Safari evicting it). */
export async function requestPersistence(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist()
    }
  } catch {
    // Not supported; nothing to do.
  }
}
