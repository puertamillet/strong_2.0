import { describe, expect, it } from 'vitest'
import type { Exercise } from '../db'
import { CATALOG, CATALOG_EXERCISES, catalogExercise, catalogKey, findCatalogExercise } from '../lib/catalog'
import {
  compareExercises,
  exerciseFinder,
  exerciseKey,
  exerciseLabel,
  filterExercises,
  missingFields,
  NO_FILTER,
} from '../lib/exercises'

const exercise = (id: string, name: string, extra: Partial<Exercise> = {}): Exercise => ({
  id,
  name,
  laterality: 'Bilateral',
  secondary: [],
  createdAt: 0,
  ...extra,
})

const benchBar = exercise('bench-bar', 'Press de banca', {
  equipment: 'Barra',
  primary: ['Pectoral'],
  secondary: ['Deltoides anterior', 'Tríceps'],
  strongNames: ['Bench Press (Barbell)'],
})
const benchDb = exercise('bench-db', 'Press de banca', { equipment: 'Mancuernas', primary: ['Pectoral'], strongNames: ['Bench Press (Dumbbell)'] })
const pullUp = exercise('pull-up', 'Dominadas', { equipment: 'Peso corporal', primary: ['Dorsal ancho'], secondary: ['Bíceps'] })
const lunge = exercise('lunge', 'Zancada', { equipment: 'Mancuernas', laterality: 'Unilateral', primary: ['Cuádriceps', 'Glúteos'] })
const all = [benchBar, benchDb, pullUp, lunge]

describe('exercise names', () => {
  it('names the equipment, but not body weight or laterality', () => {
    expect(exerciseLabel(benchBar)).toBe('Press de banca (barra)')
    expect(exerciseLabel(pullUp)).toBe('Dominadas')
    expect(exerciseLabel(lunge)).toBe('Zancada (mancuernas)')
    expect(exerciseLabel({ name: 'Sin datos' })).toBe('Sin datos')
  })

  it('tells exercises apart by name, equipment and laterality', () => {
    expect(exerciseKey(benchBar)).not.toBe(exerciseKey(benchDb))
    expect(exerciseKey({ ...benchBar, name: ' press de BANCA ' })).toBe(exerciseKey(benchBar))
    expect(exerciseKey({ ...lunge, laterality: 'Bilateral' })).not.toBe(exerciseKey(lunge))
  })

  it('sorts in Spanish alphabetical order', () => {
    const names = [exercise('a', 'Zancada'), exercise('b', 'Ábdominales'), exercise('c', 'Curl')].sort(compareExercises)
    expect(names.map((e) => e.name)).toEqual(['Ábdominales', 'Curl', 'Zancada'])
  })
})

describe('filterExercises', () => {
  const ids = (f: Partial<typeof NO_FILTER>) => filterExercises(all, { ...NO_FILTER, ...f }).map((e) => e.id)

  it('searches the name with its equipment and the names in Strong, ignoring accents', () => {
    expect(ids({ query: 'press de banca (barra' })).toEqual(['bench-bar'])
    expect(ids({ query: 'BENCH PRESS' })).toEqual(['bench-bar', 'bench-db'])
    expect(ids({ query: 'zancáda' })).toEqual(['lunge'])
  })

  it('filters by equipment, body area and muscle, with primary muscles only', () => {
    expect(ids({ equipment: 'Mancuernas' })).toEqual(['bench-db', 'lunge'])
    expect(ids({ group: 'Pierna' })).toEqual(['lunge'])
    expect(ids({ group: 'Pierna', muscle: 'Glúteos' })).toEqual(['lunge'])
    // Pull-ups work the biceps too, but not as a primary muscle.
    expect(ids({ group: 'Brazo' })).toEqual([])
    expect(ids({ muscle: 'Tríceps' })).toEqual([])
    expect(ids({ equipment: 'Mancuernas', group: 'Pecho', query: 'press' })).toEqual(['bench-db'])
  })
})

describe('missingFields', () => {
  it('lists what is left to fill in, in the order of the form', () => {
    expect(missingFields(benchBar)).toEqual([])
    expect(missingFields({ name: ' ' })).toEqual(['nombre', 'material', 'lateralidad', 'músculos principales', 'músculos secundarios'])
    // No secondary muscles is an answer; not saying is not.
    expect(missingFields({ ...benchBar, secondary: [] })).toEqual([])
    expect(missingFields({ ...benchBar, secondary: undefined, primary: [] })).toEqual(['músculos principales', 'músculos secundarios'])
  })
})

describe('exerciseFinder', () => {
  const find = exerciseFinder([...all, exercise('mine', 'Mi press', { strongNames: ['My Press'] })])

  it('finds an exercise by its names in Strong and in this app', () => {
    expect(find('bench press (barbell)')?.id).toBe('bench-bar')
    expect(find('Press de banca (mancuernas)')?.id).toBe('bench-db')
    expect(find('Dominadas')?.id).toBe('pull-up')
    expect(find('My Press')?.id).toBe('mine')
  })

  it('goes through the catalog for other names in Strong', () => {
    // «Pull Up» is not among its names in Strong, but the catalog knows it is Dominadas.
    expect(find('Pull Up')?.id).toBe('pull-up')
  })

  it('only takes a plain name when one exercise has it', () => {
    expect(find('Zancada')?.id).toBe('lunge')
    expect(find('Press de banca')).toBeUndefined()
    expect(find('Remo')).toBeUndefined()
  })
})

describe('catalog exercises', () => {
  it('are one per name, equipment and laterality, with all their names in Strong', () => {
    expect(new Set(CATALOG_EXERCISES.map(catalogKey)).size).toBe(CATALOG_EXERCISES.length)
    expect(CATALOG_EXERCISES.reduce((n, c) => n + c.strongNames.length, 0)).toBe(CATALOG.length)
    expect(catalogExercise('Glute Abductions (Machine)')?.strongNames).toEqual(['Hip Abductor (Machine)', 'Glute Abductions (Machine)'])
  })

  it('are found by the name in Strong, or in Spanish when only one has it', () => {
    expect(findCatalogExercise('squat (machine)')?.name).toBe('Sentadilla hack')
    expect(findCatalogExercise('Sentadilla hack')?.strongNames).toEqual(['Squat (Machine)'])
    expect(findCatalogExercise('Press de banca')).toBeUndefined()
  })

  it('are found done one side at a time when asked', () => {
    expect(findCatalogExercise('Leg Press', 'Unilateral')?.strongNames).toEqual(['Unilateral Leg Press'])
    expect(findCatalogExercise('Lying Leg Curl (Machine)', 'Unilateral')).toMatchObject({
      name: 'Curl femoral tumbado',
      laterality: 'Unilateral',
    })
  })
})
