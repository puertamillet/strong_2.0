import {
  DEFAULT_REST_SECONDS,
  newId,
  type Exercise,
  type SetType,
  type Workout,
  type WorkoutExercise,
  type WorkoutSet,
} from '../db'
import { catalogExercise } from './catalog'
import { parseCsv } from './csv'
import { exerciseFinder, exerciseFromCatalog } from './exercises'
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
 * Exercises are matched to `existing` by any of their names (see exerciseFinder); missing ones are
 * created, in Spanish and with their data when they are in the catalog. Each set keeps the rest that
 * followed it. Unilateral exercises stay as in Strong, one set per side.
 */
export function parseStrongCsv(text: string, existing: Exercise[]): ParsedStrong {
  const quoted: boolean[][] = []
  const rows = parseCsv(text, quoted)
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

  const find = exerciseFinder(existing)
  const created = new Map<string, Exercise>()
  const newExercises: Exercise[] = []
  const exerciseFor = (name: string): Exercise => {
    const found = find(name) ?? created.get(normalize(name))
    if (found) return found
    const c = catalogExercise(name)
    const e: Exercise = c ? exerciseFromCatalog(c, newId(), Date.now()) : { id: newId(), name, createdAt: Date.now() }
    for (const n of c?.strongNames ?? [name]) created.set(normalize(n), e)
    newExercises.push(e)
    return e
  }

  const workoutKey = (row: string[]) => `${get(row, c.date)}|${get(row, c.name) || 'Entreno'}`
  const isRest = (row: string[]) => /^rest/i.test(get(row, c.order))
  // Strong writes the Notes field in quotes on the first row of each exercise, even when empty ("").
  // When the whole file has those marks, they say exactly where each exercise starts: the same
  // exercise twice in a row, or a warm-up set logged after the others (still the same exercise).
  const notesQuoted = (r: number) => quoted[r]?.[c.notes] ?? false
  let marked = c.notes >= 0
  let firstRows = 0
  const lastExercise = new Map<string, string>()
  rows.forEach((row, r) => {
    if (r === 0 || !get(row, c.date) || !get(row, c.exercise) || isRest(row)) return
    const key = workoutKey(row)
    if (lastExercise.get(key) !== get(row, c.exercise)) {
      firstRows++
      if (!notesQuoted(r)) marked = false
    }
    lastExercise.set(key, get(row, c.exercise))
  })
  marked &&= firstRows > 0

  const workouts = new Map<string, Workout>()
  const blocks = new Map<string, Block[]>()
  /** Workouts with rest timers: in them, a set with no "Rest Timer" row after it had no rest. */
  const timed = new Set<string>()

  rows.slice(1).forEach((row, i) => {
    const date = get(row, c.date)
    const exerciseName = get(row, c.exercise)
    if (!date || !exerciseName) return
    const name = get(row, c.name) || 'Entreno'
    const key = workoutKey(row)

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
    if (isRest(row)) {
      const s = parseNum(get(row, c.seconds))
      timed.add(key)
      if (block && block.name === exerciseName && s && s > 0) {
        block.rests.push(Math.round(s))
        const last = block.exercise.sets[block.exercise.sets.length - 1]
        if (last) last.rest = Math.round(s)
      }
      return
    }

    const type = setTypeFromOrder(order)
    const number = type === 'normal' ? Number(order) || 0 : 0
    // A new block starts on a new exercise, or when the same exercise starts again: where Strong
    // marks it, or else when warm-ups come again or set numbers go back.
    const startsNew =
      !block ||
      block.name !== exerciseName ||
      (marked
        ? notesQuoted(i + 1)
        : (type === 'warmup' && block.hasNonWarmup) || (type === 'normal' && number > 0 && number <= block.lastNumber))
    if (startsNew) {
      const exercise = exerciseFor(exerciseName)
      block = {
        name: exerciseName,
        exercise: { exerciseId: exercise.id, restSeconds: DEFAULT_REST_SECONDS, sets: [] },
        lastNumber: 0,
        hasNonWarmup: false,
        rests: [],
      }
      list.push(block)
      w.exercises.push(block.exercise)
    }
    // Strong writes the exercise's note (its sticky note) on its first row.
    const note = cleanNote(get(row, c.notes))
    if (note && !block.exercise.stickyNote) block.exercise.stickyNote = note
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
      if (timed.has(key)) for (const s of b.exercise.sets) s.rest ??= 0
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

/** "1h 45m", "2h", "58m" or, under a minute, "45s", as Strong writes it. */
function strongDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const totalMin = Math.round(seconds / 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`
}

/** A text field as Strong writes it: in quotes, with line breaks written as \n. */
function strongText(text: string): string {
  return `"${text.replace(/\r?\n/g, '\\n').replace(/"/g, '""')}"`
}

function decimal(n: number | null | undefined): string {
  return Number.isInteger(n ?? 0) ? `${n ?? 0}.0` : String(n)
}

/**
 * Export finished workouts in Strong's CSV format, so the data can go to other apps too. It is
 * written as Strong writes it, down to the quotes: names in quotes, the exercise's note on its first
 * row and the workout's on its first, a "Rest Timer" row after each set that had a rest, and no
 * line break at the end.
 */
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
      let firstOfExercise = true
      const push = (s: WorkoutSet) => {
        const order =
          s.type === 'warmup' ? 'W' : s.type === 'drop' ? 'D' : s.type === 'failure' ? 'F' : String(++working)
        rows.push([
          date,
          strongText(w.name),
          duration,
          strongText(name),
          order,
          decimal(s.weight),
          decimal(s.reps),
          s.distance ?? 0,
          decimal(s.seconds),
          firstOfExercise ? strongText(e.stickyNote ?? '') : '',
          firstOfWorkout ? strongText(w.notes ?? '') : '',
          s.rpe ?? '',
        ])
        firstOfWorkout = false
        firstOfExercise = false
      }
      const rest = (seconds: number | undefined) => {
        if (seconds) {
          rows.push([date, strongText(w.name), duration, strongText(name), 'Rest Timer', 0, decimal(0), 0, decimal(seconds), '', '', ''])
        }
      }
      for (const s of e.sets) {
        push(s)
        rest(s.rest)
      }
    }
  }
  // Text fields come quoted already; the rest never needs quotes.
  return rows.map((r) => r.join(',')).join('\n')
}
