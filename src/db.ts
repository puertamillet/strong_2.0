import Dexie, { type EntityTable } from 'dexie'

/** Kinds of set. A top set is the first, heavier working set; the back off sets after it are lighter. */
export type SetType = 'normal' | 'warmup' | 'top' | 'backoff' | 'drop' | 'failure'

/** Target reps for a set, e.g. [6, 8]; [8, 8] is exactly 8. */
export type RepRange = [number, number]

/** The second side of a unilateral set, when its values differ from the first. */
export interface SideValues {
  weight: number | null
  reps: number | null
}

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
  /** 2 for a unilateral set: one row for both sides, done side by side. */
  sides?: 2
  /** Unilateral: rest between the first and the second side. Missing: same as `rest`. */
  sideRest?: number
  /** Unilateral: the first side is done; the set is done when the second side is too. */
  firstDone?: boolean
  /** Unilateral: the second side's values, when they differ from the first side's. */
  second?: SideValues
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

export interface Exercise {
  id: string
  name: string
  /** Free-form category, e.g. "Pecho", "Pierna". */
  category?: string
  notes?: string
  defaultRestSeconds?: number
  /** Unilateral exercises are done one side at a time. Missing: taken from the catalog by name. */
  laterality?: 'Bilateral' | 'Unilateral'
  createdAt: number
}

/** A set in a template: its kind, the weight and reps to do (null = take last time's), rests and target reps. */
export type TemplateSet = Pick<
  WorkoutSet,
  'type' | 'weight' | 'reps' | 'seconds' | 'distance' | 'rest' | 'sides' | 'sideRest' | 'second' | 'range'
>

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

db.version(1).stores({
  exercises: 'id, &name',
  workouts: 'id, startedAt, templateId, *exerciseIds',
  templates: 'id, name, updatedAt',
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

/** Seconds of rest between the two sides of a unilateral set. */
export function restBetweenSides(set: Pick<WorkoutSet, 'rest' | 'sideRest'>, exercise: Pick<WorkoutExercise, 'restSeconds'>): number {
  return set.sideRest ?? restAfter(set, exercise)
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
