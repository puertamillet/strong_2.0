import type { Exercise, Template, Workout } from '../db'
import { CATALOG_EXERCISES, findCatalogExercise } from './catalog'
import { exerciseFromCatalog, exerciseKey } from './exercises'
import { normalize } from './format'

export interface AppData {
  exercises: Exercise[]
  workouts: Workout[]
  templates: Template[]
}

/** Exercises as stored before the catalog (version 1). */
type LegacyExercise = Exercise & { category?: string }

/** The names without repeats, ignoring case and accents; the first spelling stays. */
function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>()
  return names.filter((n) => {
    const k = normalize(n.trim())
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export interface MigrationOptions {
  now?: number
  newId?: () => string
}

/**
 * Moves data from before the catalog to the catalog (database version 3, and old backups):
 * - Exercises take their Spanish name, equipment, laterality and muscles from the catalog, and keep
 *   their Strong names so imports still find them. The old free-form category goes away. A laterality
 *   chosen before is kept, as the sets were logged that way.
 * - Exercises that are now the same one (e.g. Strong's "Hip Abductor (Machine)" and "Glute Abductions
 *   (Machine)") are merged into the most used one, and workouts and templates point to it.
 * - The catalog's exercises that are missing are added, as on a new device. (The old starter
 *   exercises are all in the catalog, so they just turn into its exercises.)
 * Pure, and safe to run again: unchanged workouts and templates are returned as the same objects.
 */
export function migrateToCatalog(data: AppData, options: MigrationOptions = {}): AppData {
  const now = options.now ?? Date.now()
  const newId = options.newId ?? (() => crypto.randomUUID())
  const exercises = data.exercises.map((legacy: LegacyExercise): Exercise => {
    const { category: _category, ...e } = legacy
    if (e.equipment) return e
    // By its name as in Strong or, for exercises made from a template with only that, in Spanish.
    const c = findCatalogExercise(e.name, e.laterality)
    if (!c) return e
    // Its old name was Strong's (unless it was already the Spanish one): imports keep finding it.
    const oldName = normalize(e.name) === normalize(c.name) ? [] : [e.name]
    return {
      ...e,
      name: c.name,
      equipment: c.equipment,
      laterality: c.laterality,
      primary: [...c.primary],
      secondary: [...c.secondary],
      strongNames: uniqueNames([...(e.strongNames ?? []), ...oldName, ...c.strongNames]),
    }
  })

  const usage = new Map<string, number>()
  const use = (id: string) => usage.set(id, (usage.get(id) ?? 0) + 1)
  for (const w of data.workouts) w.exercises.forEach((we) => use(we.exerciseId))
  for (const t of data.templates) t.exercises.forEach((te) => use(te.exerciseId))

  // Keep the most used of each group of equal exercises (then the oldest).
  const kept = new Map<string, Exercise>()
  const mergedInto = new Map<string, string>()
  const ranked = [...exercises].sort(
    (a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || a.createdAt - b.createdAt,
  )
  for (const e of ranked) {
    const key = e.equipment ? exerciseKey(e) : `id:${e.id}`
    const keeper = kept.get(key)
    if (!keeper) {
      kept.set(key, e)
      continue
    }
    mergedInto.set(e.id, keeper.id)
    keeper.strongNames = uniqueNames([...(keeper.strongNames ?? []), ...(e.strongNames ?? [])])
    if (e.notes && !keeper.notes?.includes(e.notes)) keeper.notes = keeper.notes ? `${keeper.notes}\n${e.notes}` : e.notes
  }
  const keptIds = new Set([...kept.values()].map((e) => e.id))

  const workouts = data.workouts.map((w) => {
    if (!w.exercises.some((we) => mergedInto.has(we.exerciseId))) return w
    const list = w.exercises.map((we) =>
      mergedInto.has(we.exerciseId) ? { ...we, exerciseId: mergedInto.get(we.exerciseId)! } : we,
    )
    return { ...w, exercises: list, exerciseIds: [...new Set(list.map((we) => we.exerciseId))] }
  })

  const templates = data.templates.map((t) => {
    if (!t.exercises.some((te) => mergedInto.has(te.exerciseId))) return t
    return {
      ...t,
      exercises: t.exercises.map((te) =>
        mergedInto.has(te.exerciseId) ? { ...te, exerciseId: mergedInto.get(te.exerciseId)! } : te,
      ),
    }
  })

  const remaining = exercises.filter((e) => keptIds.has(e.id))
  const keys = new Set(remaining.map(exerciseKey))
  const missing = CATALOG_EXERCISES.filter((c) => !keys.has(exerciseKey(c))).map((c) =>
    exerciseFromCatalog(c, newId(), now),
  )
  return { exercises: [...remaining, ...missing], workouts, templates }
}
