import type { Exercise } from '../db'
import {
  catalogEntry,
  muscleGroup,
  MUSCLE_GROUPS,
  type CatalogExercise,
  type Equipment,
  type Muscle,
  type MuscleGroup,
} from './catalog'
import { normalize } from './format'

type Named = Pick<Exercise, 'name' | 'equipment' | 'laterality'>

/**
 * How an exercise is called where only text fits (dialogs, lists of names, exports): the name and its
 * equipment, e.g. "Press de banca (barra)", "Dominadas". Laterality is not part of the name: where
 * there is room it goes in a box next to it, with the equipment (see ExerciseTags).
 */
export function exerciseLabel(e: Pick<Exercise, 'name' | 'equipment'>): string {
  return e.equipment && e.equipment !== 'Peso corporal' ? `${e.name} (${e.equipment.toLowerCase()})` : e.name
}

/** The name for Strong's CSV format: its name in Strong when it has one, otherwise the app's. */
export function strongName(e: Exercise): string {
  return e.strongNames?.[0] ?? exerciseLabel(e)
}

/** Exercises with the same name, equipment and laterality are the same exercise. */
export function exerciseKey(e: Named): string {
  return `${normalize(e.name.trim())}|${e.equipment ?? ''}|${e.laterality ?? ''}`
}

/** Sorts by label, in Spanish alphabetical order. */
export function compareExercises(a: Named, b: Named): number {
  return exerciseLabel(a).localeCompare(exerciseLabel(b), 'es')
}

/** The primary muscles, as shown in lists: "Cuádriceps, Glúteos". */
export function primaryText(e: Pick<Exercise, 'primary'>): string {
  return (e.primary ?? []).join(', ')
}

/** Body areas the exercise works as a primary muscle. */
export function primaryGroups(e: Pick<Exercise, 'primary'>): MuscleGroup[] {
  return [...new Set((e.primary ?? []).map(muscleGroup))]
}

export interface ExerciseFilter {
  query: string
  group: MuscleGroup | null
  muscle: Muscle | null
  equipment: Equipment | null
}

export const NO_FILTER: ExerciseFilter = { query: '', group: null, muscle: null, equipment: null }

/** Exercises that match a search and the chips. Only primary muscles count. */
export function filterExercises<T extends Exercise>(exercises: T[], f: ExerciseFilter): T[] {
  const q = normalize(f.query.trim())
  const groupMuscles: readonly string[] = f.group ? MUSCLE_GROUPS[f.group] : []
  return exercises.filter((e) => {
    if (q && !normalize(exerciseLabel(e)).includes(q) && !(e.strongNames ?? []).some((n) => normalize(n).includes(q))) {
      return false
    }
    if (f.equipment && e.equipment !== f.equipment) return false
    const primary = e.primary ?? []
    if (f.muscle) return primary.includes(f.muscle)
    if (f.group) return primary.some((m) => groupMuscles.includes(m))
    return true
  })
}

/** The fields still to fill in before an exercise can be saved, in the order of the form. */
export function missingFields(e: Partial<Exercise>): string[] {
  const missing: string[] = []
  if (!e.name?.trim()) missing.push('nombre')
  if (!e.equipment) missing.push('material')
  if (!e.laterality) missing.push('lateralidad')
  if (!e.primary?.length) missing.push('músculos principales')
  if (!e.secondary) missing.push('músculos secundarios')
  return missing
}

/** A new exercise with the catalog's data. */
export function exerciseFromCatalog(c: CatalogExercise, id: string, createdAt: number): Exercise {
  return {
    id,
    name: c.name,
    equipment: c.equipment,
    laterality: c.laterality,
    primary: [...c.primary],
    secondary: [...c.secondary],
    strongNames: [...c.strongNames],
    createdAt,
  }
}

/**
 * Finds exercises by any of their names: as Strong writes them ("Bench Press (Barbell)"), as this app
 * shows them ("Press de banca (barra)"), through the catalog, or by plain name when only one has it.
 */
export function exerciseFinder(exercises: Exercise[]): (name: string) => Exercise | undefined {
  const byName = new Map<string, Exercise>()
  const add = (name: string, e: Exercise) => {
    const k = normalize(name.trim())
    if (k && !byName.has(k)) byName.set(k, e)
  }
  for (const e of exercises) for (const n of e.strongNames ?? []) add(n, e)
  for (const e of exercises) add(exerciseLabel(e), e)
  const byKey = new Map(exercises.map((e) => [exerciseKey(e), e]))
  const byPlainName = new Map<string, Exercise[]>()
  for (const e of exercises) {
    const k = normalize(e.name.trim())
    byPlainName.set(k, [...(byPlainName.get(k) ?? []), e])
  }

  return (name) => {
    const k = normalize(name.trim())
    const found = byName.get(k)
    if (found) return found
    const entry = catalogEntry(name)
    const viaCatalog = entry && byKey.get(exerciseKey(entry))
    if (viaCatalog) return viaCatalog
    const plain = byPlainName.get(k)
    return plain?.length === 1 ? plain[0] : undefined
  }
}
