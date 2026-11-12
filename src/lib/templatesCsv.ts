import {
  db,
  DEFAULT_REST_SECONDS,
  newId,
  type Exercise,
  type SetType,
  type Template,
  type TemplateExercise,
  type TemplateSet,
} from '../db'
import { catalogEntry, findCatalogExercise } from './catalog'
import { parseCsv, toCsv } from './csv'
import { exerciseFinder, exerciseFromCatalog, exerciseKey, exerciseLabel, strongName } from './exercises'
import { fmtClock, fmtNumber, fmtRange, normalize, parseNum, parseRange, SET_TYPE_NAMES } from './format'
import { addToNote } from './legacy'
import { sortTemplates } from './templateOrder'

/**
 * Templates as a CSV, one row per set, so they can be written or edited in a spreadsheet and
 * loaded from Ajustes. The exercise's note goes on any row of the exercise; consecutive rows of
 * the same template and exercise are one exercise. Unilateral exercises have one row per side,
 * like in Strong.
 */
export const TEMPLATE_HEADER = [
  'Plantilla',
  'Exercise Name',
  'Ejercicio',
  'Nota',
  'Serie',
  'kg',
  'Reps',
  'Rango',
  'Descanso',
] as const

/**
 * Columns of files made when a unilateral set was one row for both sides. They are still read:
 * a row with «Lados» 2 becomes two sets, one per side.
 */
const SIDE_COLUMNS = ['Lados', 'Descanso entre lados', 'kg 2º lado', 'Reps 2º lado'] as const

/** Files made when there were two notes, «Nota fija» and «Nota»: both go into the note. */
const OLD_NOTE_COLUMN = 'Nota fija'

type Column = (typeof TEMPLATE_HEADER)[number] | (typeof SIDE_COLUMNS)[number] | typeof OLD_NOTE_COLUMN

/** An exercise as written in the file: the names to find it by, plus its template data. */
export interface ParsedTemplateExercise {
  /** Name as in Strong / the app (e.g. "Bench Press (Barbell)"). */
  exerciseName: string
  /** Name in Spanish, from the catalog. */
  name: string
  /** The file said it is done one side at a time (a row with «Lados» 2). */
  unilateral?: boolean
  exercise: Omit<TemplateExercise, 'exerciseId'>
}

export interface ParsedTemplate {
  name: string
  exercises: ParsedTemplateExercise[]
}

const SET_TYPES: Record<string, SetType> = {
  '': 'normal',
  normal: 'normal',
  n: 'normal',
  calentamiento: 'warmup',
  c: 'warmup',
  w: 'warmup',
  warmup: 'warmup',
  'top set': 'top',
  top: 'top',
  t: 'top',
  'back off': 'backoff',
  'back-off': 'backoff',
  backoff: 'backoff',
  'back off set': 'backoff',
  b: 'backoff',
  'drop set': 'drop',
  drop: 'drop',
  d: 'drop',
  'al fallo': 'failure',
  fallo: 'failure',
  f: 'failure',
}

function setType(text: string): SetType | undefined {
  const t = normalize(text.trim())
  if (/^\d+$/.test(t)) return 'normal'
  return SET_TYPES[t]
}

/** "1:30", "0:00" or "90" (seconds). Empty → undefined; invalid → NaN. */
function parseRest(text: string): number | undefined {
  const t = text.trim()
  if (!t) return undefined
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(t)
  if (clock) return Number(clock[1]) * 60 + Number(clock[2])
  return /^\d{1,4}$/.test(t) ? Number(t) : NaN
}

/** The most frequent value; the largest of a tie (a unilateral exercise rests 0:00 and 1:30 by turns). */
function mostFrequent(values: number[]): number | undefined {
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: number | undefined
  for (const [v, n] of counts) {
    const top = best === undefined ? 0 : counts.get(best)!
    if (n > top || (n === top && v > best!)) best = v
  }
  return best
}

/** Reads a templates CSV. Throws with the row number of the first bad value. */
export function parseTemplatesCsv(text: string): ParsedTemplate[] {
  const rows = parseCsv(text)
  if (rows.length < 2) throw new Error('El archivo no tiene ninguna serie.')
  const head = rows[0].map((h) => normalize(h.trim()))
  const col = (name: Column) => head.indexOf(normalize(name))
  if (col('Plantilla') === -1 || (col('Exercise Name') === -1 && col('Ejercicio') === -1)) {
    throw new Error('No parece un CSV de plantillas: faltan las columnas Plantilla y Ejercicio.')
  }

  const templates = new Map<string, ParsedTemplate>()
  let current: { template: string; key: string; entry: ParsedTemplateExercise } | null = null

  rows.slice(1).forEach((row, i) => {
    const line = i + 2
    const get = (name: Column) => {
      const c = col(name)
      return c === -1 ? '' : (row[c] ?? '').trim()
    }
    const fail = (what: string): never => {
      throw new Error(`Fila ${line}: ${what}`)
    }
    const templateName = get('Plantilla')
    const exerciseName = get('Exercise Name')
    const name = get('Ejercicio')
    if (!templateName && !exerciseName && !name) return
    if (!templateName) fail('falta el nombre de la plantilla')
    if (!exerciseName && !name) fail('falta el ejercicio')

    const type = setType(get('Serie'))
    if (!type) fail(`tipo de serie desconocido «${get('Serie')}»`)
    const weight = parseNum(get('kg'))
    const reps = parseNum(get('Reps'))
    if (get('kg') && weight === null) fail(`peso no válido «${get('kg')}»`)
    if (get('Reps') && reps === null) fail(`repeticiones no válidas «${get('Reps')}»`)
    const range = parseRange(get('Rango'))
    if (range === undefined) fail(`rango no válido «${get('Rango')}» (escribe por ejemplo 6-8)`)
    const rest = parseRest(get('Descanso'))
    if (Number.isNaN(rest)) fail(`descanso no válido «${get('Descanso')}» (escribe por ejemplo 1:30)`)
    const sidesText = get('Lados')
    if (sidesText && sidesText !== '1' && sidesText !== '2') fail(`lados debe ser 1 o 2, no «${sidesText}»`)
    const sideRest = parseRest(get('Descanso entre lados'))
    if (Number.isNaN(sideRest)) fail(`descanso entre lados no válido «${get('Descanso entre lados')}»`)
    const weight2 = parseNum(get('kg 2º lado'))
    const reps2 = parseNum(get('Reps 2º lado'))

    const set: TemplateSet = { type: type!, weight, reps }
    if (rest !== undefined) set.rest = rest
    if (range) set.range = range
    const twoSided = sidesText === '2'
    const sets: TemplateSet[] = [set]
    if (twoSided) {
      // One set per side: the first rests what was the rest between sides.
      const first: TemplateSet = { ...set }
      const firstRest = sideRest ?? rest
      if (firstRest === undefined) delete first.rest
      else first.rest = firstRest
      sets.unshift(first)
      set.weight = weight2 ?? weight
      set.reps = reps2 ?? reps
    }

    const key = normalize(exerciseName || name)
    if (!current || current.template !== templateName || current.key !== key) {
      const entry: ParsedTemplateExercise = {
        exerciseName: exerciseName || name,
        name: name || catalogEntry(exerciseName)?.name || exerciseName,
        exercise: { restSeconds: DEFAULT_REST_SECONDS, sets: [] },
      }
      current = { template: templateName, key, entry }
      let template = templates.get(templateName)
      if (!template) {
        template = { name: templateName, exercises: [] }
        templates.set(templateName, template)
      }
      template.exercises.push(entry)
    }
    const exercise = current.entry.exercise
    exercise.sets.push(...sets)
    if (twoSided) current.entry.unilateral = true
    for (const text of [get(OLD_NOTE_COLUMN), get('Nota')]) {
      const note = addToNote(exercise.stickyNote, text)
      if (note) exercise.stickyNote = note
    }
  })

  for (const t of templates.values()) {
    for (const { exercise } of t.exercises) {
      const rests = exercise.sets.map((s) => s.rest).filter((r): r is number => r !== undefined)
      exercise.restSeconds = mostFrequent(rests) ?? DEFAULT_REST_SECONDS
    }
  }
  return [...templates.values()]
}

/** The templates as CSV (same columns as the import). */
export function templatesToCsv(templates: Template[], exercises: Map<string, Exercise>): string {
  const rows: (string | number | null)[][] = [[...TEMPLATE_HEADER]]
  for (const t of templates) {
    for (const te of t.exercises) {
      const exercise = exercises.get(te.exerciseId)
      const exerciseName = exercise ? strongName(exercise) : 'Ejercicio eliminado'
      const name = exercise ? exerciseLabel(exercise) : exerciseName
      te.sets.forEach((s, i) => {
        rows.push([
          t.name,
          exerciseName,
          name,
          i === 0 ? (te.stickyNote ?? '') : '',
          SET_TYPE_NAMES[s.type],
          fmtNumber(s.weight),
          fmtNumber(s.reps),
          s.range ? fmtRange(s.range).replace('–', '-') : '',
          fmtClock(s.rest ?? te.restSeconds),
        ])
      })
    }
  }
  return toCsv(rows)
}

export interface TemplateImportPlan {
  templates: Template[]
  /** Names of existing templates that will be replaced. */
  replaced: string[]
  /** Exercises that don't exist yet and will be created. */
  newExercises: Exercise[]
}

/**
 * Works out what importing the file would do: templates with the same name (ignoring case and
 * accents) are replaced, keeping their id; exercises are found by any of their names (Strong's, the
 * app's or the catalog's) and created if missing, with the catalog's data when it has them.
 */
export function planTemplateImport(parsed: ParsedTemplate[], existing: Template[], exercises: Exercise[]): TemplateImportPlan {
  const find = exerciseFinder(exercises)
  const created = new Map<string, Exercise>()
  const newExercises: Exercise[] = []
  const exerciseFor = (p: ParsedTemplateExercise): Exercise => {
    const found = find(p.exerciseName) ?? find(p.name)
    if (found) return found
    // Both sides in a row: done one side at a time.
    const laterality = p.unilateral ? 'Unilateral' : undefined
    const c = findCatalogExercise(p.exerciseName, laterality) ?? findCatalogExercise(p.name, laterality)
    const draft: Exercise = c
      ? exerciseFromCatalog(c, newId(), Date.now())
      : {
          id: newId(),
          name: p.name,
          laterality: laterality ?? 'Bilateral',
          ...(p.exerciseName !== p.name && { strongNames: [p.exerciseName] }),
          createdAt: Date.now(),
        }
    const again = created.get(exerciseKey(draft))
    if (again) return again
    created.set(exerciseKey(draft), draft)
    newExercises.push(draft)
    return draft
  }

  const existingByName = new Map(existing.map((t) => [normalize(t.name.trim()), t]))
  const replaced: string[] = []
  const templates = parsed.map((p): Template => {
    const old = existingByName.get(normalize(p.name))
    if (old) replaced.push(old.name)
    return {
      id: old?.id ?? newId(),
      name: p.name,
      updatedAt: Date.now(),
      exercises: p.exercises.map((e) => ({ exerciseId: exerciseFor(e).id, ...e.exercise })),
      // A replaced template keeps its place in the list.
      ...(old?.order !== undefined && { order: old.order }),
    }
  })
  return { templates, replaced, newExercises }
}

/** Reads the file and plans the import against what is on this device. */
export async function prepareTemplateImport(text: string): Promise<TemplateImportPlan> {
  const parsed = parseTemplatesCsv(text)
  const [templates, exercises] = await Promise.all([db.templates.toArray(), db.exercises.toArray()])
  return planTemplateImport(parsed, templates, exercises)
}

export async function applyTemplateImport(plan: TemplateImportPlan): Promise<void> {
  await db.transaction('rw', db.exercises, db.templates, async () => {
    await db.exercises.bulkAdd(plan.newExercises)
    await db.templates.bulkPut(plan.templates)
  })
}

export async function exportTemplatesCsv(): Promise<string> {
  const [templates, exercises] = await Promise.all([db.templates.toArray(), db.exercises.toArray()])
  return templatesToCsv(sortTemplates(templates), new Map(exercises.map((e) => [e.id, e])))
}
