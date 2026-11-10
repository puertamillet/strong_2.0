import { describe, expect, it } from 'vitest'
import type { Exercise, Template, Workout } from '../db'
import { CATALOG_EXERCISES } from '../lib/catalog'
import { exerciseKey } from '../lib/exercises'
import { migrateToCatalog, type AppData } from '../lib/migrations'

type Legacy = Exercise & { category?: string }

const legacy = (id: string, name: string, extra: Partial<Legacy> = {}): Legacy => ({ id, name, createdAt: 0, ...extra })

const workout = (id: string, exerciseIds: string[]): Workout => ({
  id,
  name: id,
  startedAt: 0,
  endedAt: 1,
  source: 'strong',
  exercises: exerciseIds.map((exerciseId) => ({ exerciseId, restSeconds: 120, sets: [{ type: 'normal', weight: 10, reps: 10, done: true }] })),
  exerciseIds: [...new Set(exerciseIds)],
})

const template = (id: string, exerciseIds: string[]): Template => ({
  id,
  name: id,
  updatedAt: 0,
  exercises: exerciseIds.map((exerciseId) => ({ exerciseId, restSeconds: 120, sets: [{ type: 'normal', weight: 40, reps: 12 }] })),
})

let counter = 0
const options = { now: 5, newId: () => `new-${++counter}` }

/** Only the exercises that were there before (not the ones added from the catalog). */
function migrate(data: Partial<AppData>) {
  const before = { exercises: [], workouts: [], templates: [], ...data }
  const after = migrateToCatalog(before, options)
  return { ...after, kept: after.exercises.filter((e) => !e.id.startsWith('new-')) }
}

// The starter exercises of the app before the catalog, as they were named.
const OLD_STARTERS = [
  'Bench Press (Barbell)', 'Bench Press (Dumbbell)', 'Incline Bench Press (Barbell)', 'Incline Bench Press (Dumbbell)',
  'Chest Press (Machine)', 'Incline Chest Press (Machine)', 'Chest Fly', 'Chest Fly (Cable)', 'Cable Crossover', 'Push Up',
  'Deadlift (Barbell)', 'Pull Up', 'Chin Up', 'Lat Pulldown (Cable)', 'Lat Pulldown (Machine)', 'Seated Row (Cable)',
  'Seated Row (Machine)', 'Bent Over Row (Barbell)', 'Bent Over One Arm Row (Dumbbell)', 'T Bar Row', 'Face Pull (Cable)',
  'Overhead Press (Barbell)', 'Shoulder Press (Dumbbell)', 'Shoulder Press (Machine)', 'Arnold Press (Dumbbell)',
  'Lateral Raise (Dumbbell)', 'Lateral Raise (Cable)', 'Reverse Fly (Machine)', 'Bicep Curl (Barbell)',
  'Bicep Curl (Dumbbell)', 'Bicep Curl (Cable)', 'Hammer Curl (Dumbbell)', 'Preacher Curl (Machine)',
  'Triceps Extension (Cable)', 'Triceps Extension Overhead (Cable)', 'Skullcrusher (Barbell)', 'Triceps Dip',
  'Squat (Barbell)', 'Front Squat (Barbell)', 'Leg Press', 'Leg Extension (Machine)', 'Lying Leg Curl (Machine)',
  'Seated Leg Curl (Machine)', 'Romanian Deadlift (Barbell)', 'Hip Thrust (Barbell)', 'Bulgarian Split Squat (Dumbbell)',
  'Hip Abductor (Machine)', 'Hip Adductor (Machine)', 'Standing Calf Raise (Machine)', 'Seated Calf Raise (Machine)',
  'Crunch (Machine)', 'Cable Crunch', 'Hanging Leg Raise', 'Plank',
]

describe('migrateToCatalog', () => {
  it('gives exercises their name in Spanish and the data of the catalog', () => {
    const { kept } = migrate({
      exercises: [
        legacy('press', 'Leg Press', { category: 'Pierna', notes: 'Asiento 3', defaultRestSeconds: 90 }),
        legacy('hack', 'Sentadilla hack', { laterality: 'Bilateral' }),
        legacy('mine', 'Mi ejercicio', { category: 'Brazo' }),
      ],
    })
    const [press, hack, mine] = kept
    expect(press).toEqual({
      id: 'press',
      name: 'Prensa',
      equipment: 'Máquina de discos',
      laterality: 'Bilateral',
      primary: ['Cuádriceps', 'Glúteos'],
      secondary: ['Aductores'],
      strongNames: ['Leg Press'],
      notes: 'Asiento 3',
      defaultRestSeconds: 90,
      createdAt: 0,
    })
    // Made from a template with only its name in Spanish.
    expect(hack).toMatchObject({ name: 'Sentadilla hack', equipment: 'Máquina de discos', strongNames: ['Squat (Machine)'] })
    // Not in the catalog: as it was, without the old category.
    expect(mine).toEqual({ id: 'mine', name: 'Mi ejercicio', createdAt: 0 })
  })

  it('keeps a laterality chosen before', () => {
    const { kept } = migrate({
      exercises: [legacy('one-leg', 'Leg Press', { laterality: 'Unilateral' }), legacy('curl', 'Lying Leg Curl (Machine)', { laterality: 'Unilateral' })],
    })
    // The catalog's one-sided variant, still found by its old name.
    expect(kept[0]).toMatchObject({ name: 'Prensa', laterality: 'Unilateral', strongNames: ['Leg Press', 'Unilateral Leg Press'] })
    // No such variant: the same exercise, one side at a time.
    expect(kept[1]).toMatchObject({ name: 'Curl femoral tumbado', laterality: 'Unilateral', strongNames: ['Lying Leg Curl (Machine)'] })
  })

  it('merges exercises that are now the same into the most used one', () => {
    const w1 = workout('w1', ['abductor', 'press'])
    const w2 = workout('w2', ['abductions', 'abductor'])
    const w3 = workout('w3', ['abductions'])
    const t1 = template('t1', ['abductor'])
    const t2 = template('t2', ['press'])
    const { kept, workouts, templates } = migrate({
      exercises: [
        legacy('abductor', 'Hip Abductor (Machine)', { notes: 'Asiento 3' }),
        legacy('abductions', 'Glute Abductions (Machine)', { notes: 'Despacio' }),
        legacy('press', 'Leg Press'),
      ],
      workouts: [w1, w2, w3],
      templates: [t1, t2],
    })
    expect(kept.map((e) => e.id)).toEqual(['abductor', 'press'])
    expect(kept[0]).toMatchObject({
      name: 'Abducción de cadera',
      strongNames: ['Hip Abductor (Machine)', 'Glute Abductions (Machine)'],
      notes: 'Asiento 3\nDespacio',
    })
    expect(workouts[1].exercises.map((e) => e.exerciseId)).toEqual(['abductor', 'abductor'])
    expect(workouts[1].exerciseIds).toEqual(['abductor'])
    expect(workouts[2].exerciseIds).toEqual(['abductor'])
    // What did not change is the same object: the database only rewrites the others.
    expect(workouts[0]).toBe(w1)
    expect(templates[0]).toBe(t1)
    expect(templates[1]).toBe(t2)
  })

  it('adds the catalog exercises that are missing, and nothing when run again', () => {
    const first = migrate({ exercises: [legacy('press', 'Leg Press')] })
    expect(first.exercises).toHaveLength(CATALOG_EXERCISES.length)
    expect(first.exercises.filter((e) => e.id !== 'press').every((e) => e.createdAt === 5 && e.primary?.length)).toBe(true)
    const again = migrateToCatalog(first, options)
    expect(again.exercises).toEqual(first.exercises)
  })

  it('turns the old starter exercises into the catalog ones', () => {
    const { exercises, kept } = migrate({ exercises: OLD_STARTERS.map((name, i) => legacy(`s${i}`, name, { category: 'X' })) })
    expect(kept).toHaveLength(OLD_STARTERS.length)
    expect(kept.every((e) => e.equipment && !('category' in e))).toBe(true)
    expect(new Set(exercises.map(exerciseKey)).size).toBe(exercises.length)
  })
})
