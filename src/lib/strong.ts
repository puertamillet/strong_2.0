import {
  DEFAULT_REST_SECONDS,
  newId,
  type Exercise,
  type SetType,
  type Workout,
  type WorkoutExercise,
  type WorkoutSet,
} from '../db'
import { guessCategory } from '../seed'
import { parseCsv, toCsv } from './csv'
import { normalize, parseNum } from './format'

/** Column layout of Strong's "Export data" CSV. */
export const STRONG_HEADER = [
  'Date',
  'Workout Name',
  'Duration',
  'Exercise Name',
  'Set Order',
  'Weight',
  'Reps',
  'Distance',
  'Seconds',
  'Notes',
  'Workout Notes',
  'RPE',
] as const

const REQUIRED = ['Date', 'Workout Name', 'Exercise Name', 'Set Order', 'Weight', 'Reps']

export interface ParsedStrong {
  workouts: Workout[]
  /** Exercises referenced by the file that do not exist yet. */
  newExercises: Exercise[]
}

/** "2024-04-15 20:35:10" → local timestamp. */
export function parseStrongDate(s: string): number {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (m) {
    const [, y, mo, d, h, mi, sec] = m
    return new Date(+y, +mo - 1, +d, +h, +mi, sec ? +sec : 0).getTime()
  }
  const t = Date.parse(s)
  if (Number.isNaN(t)) throw new Error(`Fecha no válida: «${s}»`)
  return t
}

/** "1h 45m" / "45m" / "1h" / "30s" → milliseconds. */
export function parseStrongDuration(s: string): number {
  const h = s.match(/(\d+)\s*h/)?.[1]
  const m = s.match(/(\d+)\s*m(?!s)/)?.[1]
  const sec = s.match(/(\d+)\s*s/)?.[1]
  return ((Number(h ?? 0) * 60 + Number(m ?? 0)) * 60 + Number(sec ?? 0)) * 1000
}

function cleanNote(s: string | undefined): string | undefined {
  const t = (s ?? '').replace(/\\n/g, '\n').trim()
  return t || undefined
}

function setTypeFromOrder(order: string): SetType {
  switch (order.toUpperCase()) {
    case 'W':
      return 'warmup'
    case 'D':
      return 'drop'
    case 'F':
      return 'failure'
    default:
      return 'normal'
  }
}

function slug(s: string): string {
  return normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'entreno'
}

/** Stable id so importing the same file twice does not duplicate workouts. */
function workoutId(date: string, name: string): string {
  return `strong-${date.replace(/\D/g, '')}-${slug(name)}`
}

function mostFrequent(values: number[]): number | undefined {
  const counts = new Map<number, number>()
  let best: number | undefined
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1
    counts.set(v, n)
    if (best === undefined || n > (counts.get(best) ?? 0)) best = v
  }
  return best
}

interface Block {
  name: string
  exercise: WorkoutExercise
  lastNumber: number
  hasNonWarmup: boolean
  rests: number[]
}

/**
 * Convert a Strong CSV export into workouts. Pure: does not touch the database.
 * Exercises are matched to `existing` by name, ignoring case and accents.
 */
export function parseStrongCsv(text: string, existing: Exercise[]): ParsedStrong {
  const rows = parseCsv(text)
  if (rows.length < 2) throw new Error('El archivo está vacío.')

  const head = rows[0].map((h) => h.trim().toLowerCase())
  const col = (name: string) => head.indexOf(name.toLowerCase())
  const missing = REQUIRED.filter((c) => col(c) === -1)
  if (missing.length) {
    throw new Error(`No parece un CSV de Strong: faltan las columnas ${missing.join(', ')}.`)
  }
  const c = {
    date: col('Date'),
    name: col('Workout Name'),
    duration: col('Duration'),
    exercise: col('Exercise Name'),
    order: col('Set Order'),
    weight: col('Weight'),
    reps: col('Reps'),
    distance: col('Distance'),
    seconds: col('Seconds'),
    notes: col('Notes'),
    workoutNotes: col('Workout Notes'),
    rpe: col('RPE'),
  }
  const get = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '')

  const exerciseIds = new Map(existing.map((e) => [normalize(e.name), e.id]))
  const newExercises: Exercise[] = []
  const exerciseIdFor = (name: string) => {
    const key = normalize(name)
    let id = exerciseIds.get(key)
    if (!id) {
      id = newId()
      exerciseIds.set(key, id)
      newExercises.push({ id, name, category: guessCategory(name), createdAt: Date.now() })
    }
    return id
  }

  const workouts = new Map<string, Workout>()
  const blocks = new Map<string, Block[]>()

  rows.slice(1).forEach((row, i) => {
    const date = get(row, c.date)
    const exerciseName = get(row, c.exercise)
    if (!date || !exerciseName) return
    const name = get(row, c.name) || 'Entreno'
    const key = `${date}|${name}`

    let w = workouts.get(key)
    if (!w) {
      let startedAt: number
      try {
        startedAt = parseStrongDate(date)
      } catch (e) {
        throw new Error(`Fila ${i + 2}: ${(e as Error).message}`)
      }
      w = {
        id: workoutId(date, name),
        name,
        startedAt,
        endedAt: startedAt + parseStrongDuration(get(row, c.duration)),
        notes: cleanNote(get(row, c.workoutNotes)),
        source: 'strong',
        exercises: [],
        exerciseIds: [],
      }
      workouts.set(key, w)
      blocks.set(key, [])
    } else if (!w.notes) {
      w.notes = cleanNote(get(row, c.workoutNotes))
    }

    const list = blocks.get(key)!
    let block = list[list.length - 1]
    const order = get(row, c.order)

    // Strong writes a "Rest Timer" row after each set with the rest used.
    if (/^rest/i.test(order)) {
      const s = parseNum(get(row, c.seconds))
      if (block && block.name === exerciseName && s && s > 0) block.rests.push(Math.round(s))
      return
    }

    const type = setTypeFromOrder(order)
    const number = type === 'normal' ? Number(order) || 0 : 0
    // A new block starts on a new exercise, or when the same exercise restarts
    // (warm-ups again, or set numbers going back), e.g. the same exercise done twice.
    const startsNew =
      !block ||
      block.name !== exerciseName ||
      (type === 'warmup' && block.hasNonWarmup) ||
      (type === 'normal' && number > 0 && number <= block.lastNumber)
    if (startsNew) {
      block = {
        name: exerciseName,
        exercise: { exerciseId: exerciseIdFor(exerciseName), restSeconds: DEFAULT_REST_SECONDS, sets: [] },
        lastNumber: 0,
        hasNonWarmup: false,
        rests: [],
      }
      list.push(block)
      w.exercises.push(block.exercise)
    }
    if (!block.exercise.notes) block.exercise.notes = cleanNote(get(row, c.notes))
    if (type !== 'warmup') block.hasNonWarmup = true
    if (number) block.lastNumber = number

    const set: WorkoutSet = {
      type,
      weight: parseNum(get(row, c.weight)),
      reps: parseNum(get(row, c.reps)),
      done: true,
    }
    const distance = parseNum(get(row, c.distance))
    const seconds = parseNum(get(row, c.seconds))
    const rpe = parseNum(get(row, c.rpe))
    if (distance) set.distance = distance
    if (seconds) set.seconds = seconds
    if (rpe) set.rpe = rpe
    block.exercise.sets.push(set)
  })

  const result: Workout[] = []
  for (const [key, w] of workouts) {
    for (const b of blocks.get(key)!) {
      b.exercise.restSeconds = mostFrequent(b.rests) ?? DEFAULT_REST_SECONDS
    }
    w.exercises = w.exercises.filter((e) => e.sets.length > 0)
    if (!w.exercises.length) continue
    w.exerciseIds = [...new Set(w.exercises.map((e) => e.exerciseId))]
    result.push(w)
  }
  result.sort((a, b) => a.startedAt - b.startedAt)

  const used = new Set(result.flatMap((w) => w.exerciseIds))
  return { workouts: result, newExercises: newExercises.filter((e) => used.has(e.id)) }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function strongDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function strongDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h ? `${h}h ${m}m` : `${m}m`
}

function decimal(n: number | null | undefined): string {
  return Number.isInteger(n ?? 0) ? `${n ?? 0}.0` : String(n)
}

/** Export finished workouts in Strong's CSV format, so the data can go to other apps too. */
export function workoutsToStrongCsv(workouts: Workout[], exerciseNames: Map<string, string>): string {
  const rows: (string | number)[][] = [[...STRONG_HEADER]]
  const finished = workouts.filter((w) => w.endedAt !== null).sort((a, b) => a.startedAt - b.startedAt)
  for (const w of finished) {
    const date = strongDate(w.startedAt)
    const duration = strongDuration((w.endedAt ?? w.startedAt) - w.startedAt)
    let firstOfWorkout = true
    for (const e of w.exercises) {
      const name = exerciseNames.get(e.exerciseId) ?? 'Ejercicio'
      let working = 0
      e.sets.forEach((s, i) => {
        const order =
          s.type === 'warmup' ? 'W' : s.type === 'drop' ? 'D' : s.type === 'failure' ? 'F' : String(++working)
        rows.push([
          date,
          w.name,
          duration,
          name,
          order,
          decimal(s.weight),
          decimal(s.reps),
          s.distance ?? 0,
          decimal(s.seconds),
          i === 0 ? (e.notes ?? '') : '',
          firstOfWorkout ? (w.notes ?? '') : '',
          s.rpe ?? '',
        ])
        firstOfWorkout = false
      })
    }
  }
  return toCsv(rows)
}
