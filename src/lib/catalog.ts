import raw from '../data/ejercicios.csv?raw'
import { parseCsv } from './csv'

/**
 * Exercise catalog: the source of truth for names in Spanish and classifications.
 * It lives in src/data/ejercicios.csv so it can be reviewed and edited as a table;
 * each row maps one Strong exercise name to its standard entry. Rows that share
 * name, equipment and laterality are the same exercise (Strong duplicates merged).
 */

export const EQUIPMENT = [
  'Peso corporal',
  'Mancuernas',
  'Barra',
  'Kettlebell',
  'Cables',
  'Máquina de discos',
  'Máquina de placas',
] as const
export type Equipment = (typeof EQUIPMENT)[number]

export const LATERALITY = ['Bilateral', 'Unilateral'] as const
export type Laterality = (typeof LATERALITY)[number]

/** Muscles by body area. The areas group the weekly stats; the muscles go on the body figure. */
export const MUSCLE_GROUPS = {
  Pecho: ['Pectoral'],
  Espalda: ['Dorsal ancho', 'Trapecio', 'Romboides', 'Lumbares'],
  Hombro: ['Deltoides anterior', 'Deltoides lateral', 'Deltoides posterior'],
  Brazo: ['Bíceps', 'Tríceps', 'Antebrazo'],
  Pierna: ['Cuádriceps', 'Isquiotibiales', 'Glúteos', 'Aductores', 'Abductores', 'Gemelos'],
  Abdomen: ['Abdominales', 'Oblicuos'],
} as const satisfies Record<string, readonly string[]>
export type MuscleGroup = keyof typeof MUSCLE_GROUPS
export type Muscle = (typeof MUSCLE_GROUPS)[MuscleGroup][number]
export const MUSCLES: readonly Muscle[] = Object.values(MUSCLE_GROUPS).flat()

export function muscleGroup(muscle: Muscle): MuscleGroup {
  return (Object.keys(MUSCLE_GROUPS) as MuscleGroup[]).find((g) =>
    (MUSCLE_GROUPS[g] as readonly string[]).includes(muscle),
  )!
}

export interface CatalogEntry {
  /** Exercise name in the Strong export. */
  strong: string
  name: string
  equipment: Equipment
  laterality: Laterality
  primary: Muscle[]
  secondary: Muscle[]
}

const HEADER = ['strong', 'nombre', 'material', 'lateralidad', 'principales', 'secundarios', 'revisar']

/** Parses and checks the catalog CSV. Throws with the line number of the first bad value. */
export function parseCatalog(text: string): CatalogEntry[] {
  const [header, ...rows] = parseCsv(text).filter((r) => r.some((c) => c.trim()))
  if (HEADER.some((h, i) => header?.[i]?.trim() !== h)) throw new Error(`Cabecera esperada: ${HEADER.join(',')}`)

  return rows.map((r, i) => {
    const line = i + 2
    const [strong, name, equipment, laterality, primary, secondary] = r.map((c) => c.trim())
    const fail = (what: string) => {
      throw new Error(`ejercicios.csv, línea ${line}: ${what}`)
    }
    const muscles = (list: string) =>
      list
        ? list.split('+').map((m) => {
            const muscle = m.trim()
            if (!(MUSCLES as readonly string[]).includes(muscle)) fail(`músculo desconocido «${muscle}»`)
            return muscle as Muscle
          })
        : []

    if (!strong) fail('falta el nombre de Strong')
    if (!name) fail('falta el nombre')
    if (!(EQUIPMENT as readonly string[]).includes(equipment)) fail(`material desconocido «${equipment}»`)
    if (!(LATERALITY as readonly string[]).includes(laterality)) fail(`lateralidad desconocida «${laterality}»`)
    const entry: CatalogEntry = {
      strong,
      name,
      equipment: equipment as Equipment,
      laterality: laterality as Laterality,
      primary: muscles(primary),
      secondary: muscles(secondary),
    }
    if (!entry.primary.length) fail('faltan los músculos principales')
    return entry
  })
}

export const CATALOG: readonly CatalogEntry[] = parseCatalog(raw)

/** Key that identifies one exercise: rows with the same key are the same exercise. */
export function catalogKey(e: Pick<CatalogEntry, 'name' | 'equipment' | 'laterality'>): string {
  return `${e.name}|${e.equipment}|${e.laterality}`
}
