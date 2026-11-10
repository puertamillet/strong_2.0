import Dexie, { type EntityTable } from 'dexie'

export type SetType = 'normal' | 'warmup' | 'drop' | 'failure'

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
}

export interface WorkoutExercise {
  exerciseId: string
  notes?: string
  /** Rest timer for this exercise, in seconds. */
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
  createdAt: number
}

/** A set in a template: its kind and the weight and reps to do (null = take last time's). */
export type TemplateSet = Pick<WorkoutSet, 'type' | 'weight' | 'reps' | 'seconds' | 'distance'>

export interface TemplateExercise {
  exerciseId: string
  restSeconds: number
  sets: TemplateSet[]
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

export function newId(): string {
  return crypto.randomUUID()
}

export function emptySet(type: SetType = 'normal'): WorkoutSet {
  return { type, weight: null, reps: null, done: false }
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
