import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, newId, type Template } from '../db'
import {
  addExercisesToWorkout,
  differsFromTemplate,
  finishWorkout,
  getActiveWorkout,
  lastPerformance,
  mutateWorkout,
  saveWorkout,
  startWorkout,
  syncTemplate,
  templateWithValues,
} from '../lib/workouts'

const bench = { id: 'bench', name: 'Bench Press (Barbell)', createdAt: 0 }
const squat = { id: 'squat', name: 'Squat (Barbell)', createdAt: 0 }

beforeEach(async () => {
  await Promise.all([db.workouts.clear(), db.exercises.clear(), db.templates.clear()])
  await db.exercises.bulkAdd([bench, squat])
})

async function logWorkout(sets: [number, number][], startedAt: number) {
  const id = await startWorkout()
  await addExercisesToWorkout(id, ['bench'])
  await mutateWorkout(id, (w) => {
    w.startedAt = startedAt
    w.exercises[0].sets = sets.map(([weight, reps]) => ({ type: 'normal', weight, reps, done: true }))
  })
  await finishWorkout(id)
  return id
}

describe('workouts', () => {
  it('has a single active workout', async () => {
    const a = await startWorkout()
    const b = await startWorkout()
    expect(b).toBe(a)
    expect((await getActiveWorkout())?.id).toBe(a)
  })

  it('finishing drops undone sets and empty exercises', async () => {
    const id = await startWorkout()
    await addExercisesToWorkout(id, ['bench', 'squat'])
    await mutateWorkout(id, (w) => {
      w.exercises[0].sets = [
        { type: 'normal', weight: 60, reps: 8, done: true },
        { type: 'normal', weight: 60, reps: null, done: false },
      ]
    })
    expect(await finishWorkout(id)).toBe(true)
    const w = await db.workouts.get(id)
    expect(w?.endedAt).not.toBeNull()
    expect(w?.exercises).toHaveLength(1)
    expect(w?.exercises[0].sets).toHaveLength(1)
    expect(w?.exerciseIds).toEqual(['bench'])
    expect(await getActiveWorkout()).toBeUndefined()
  })

  it('finishing with nothing done deletes the workout', async () => {
    const id = await startWorkout()
    await addExercisesToWorkout(id, ['bench'])
    expect(await finishWorkout(id)).toBe(false)
    expect(await db.workouts.get(id)).toBeUndefined()
  })

  it('finds the last performance and pre-fills the same number of sets', async () => {
    await logWorkout([[50, 10]], 1000)
    await logWorkout([[60, 8], [60, 8], [60, 7]], 2000)
    const last = await lastPerformance('bench')
    expect(last?.sets.map((s) => s.weight)).toEqual([60, 60, 60])

    const id = await startWorkout()
    await addExercisesToWorkout(id, ['bench'])
    const w = await db.workouts.get(id)
    expect(w?.exercises[0].sets).toHaveLength(3)
    expect(w?.exercises[0].sets.every((s) => s.weight === null && !s.done)).toBe(true)
    // The active workout itself is never "last time".
    expect((await lastPerformance('bench', id))?.sets).toHaveLength(3)
  })

  it('starts from a template and detects changes to it', async () => {
    const t: Template = {
      id: newId(),
      name: 'Pierna',
      updatedAt: 0,
      exercises: [{ exerciseId: 'squat', restSeconds: 180, sets: [{ type: 'warmup', weight: null, reps: null }, { type: 'normal', weight: null, reps: null }] }],
    }
    await db.templates.add(t)
    const id = await startWorkout(t)
    let w = (await db.workouts.get(id))!
    expect(w.name).toBe('Pierna')
    expect(w.templateId).toBe(t.id)
    expect(w.exercises[0].sets.map((s) => s.type)).toEqual(['warmup', 'normal'])
    expect(w.exercises[0].restSeconds).toBe(180)

    await mutateWorkout(id, (x) => x.exercises[0].sets.forEach((s) => (s.done = true)))
    w = (await db.workouts.get(id))!
    expect(differsFromTemplate(w, t)).toBe(false)
    await mutateWorkout(id, (x) => x.exercises[0].sets.push({ type: 'normal', weight: 100, reps: 5, done: true }))
    w = (await db.workouts.get(id))!
    expect(differsFromTemplate(w, t)).toBe(true)
  })

  it('saving an edited workout drops unticked sets, and refuses to leave it empty', async () => {
    const id = await logWorkout([[60, 8], [60, 8]], 1000)
    const w = (await db.workouts.get(id))!
    w.exercises[0].sets[1].done = false
    expect(await saveWorkout(w)).toBe(true)
    expect((await db.workouts.get(id))?.exercises[0].sets).toHaveLength(1)
    w.exercises[0].sets[0].done = false
    expect(await saveWorkout(w)).toBe(false)
    expect((await db.workouts.get(id))?.exercises[0].sets).toHaveLength(1)
  })
})

describe('templates after a workout', () => {
  const template = (): Template => ({
    id: 'pierna',
    name: 'Pierna',
    updatedAt: 0,
    exercises: [
      {
        exerciseId: 'squat',
        restSeconds: 180,
        sets: [
          { type: 'warmup', weight: 60, reps: 5 },
          { type: 'normal', weight: 100, reps: 5 },
          { type: 'normal', weight: 90, reps: 8 },
        ],
      },
      { exerciseId: 'bench', restSeconds: 120, sets: [{ type: 'normal', weight: null, reps: null }] },
    ],
  })

  async function startFrom(t: Template) {
    await db.templates.put(t)
    return startWorkout(t)
  }

  it('starts with the template weights and reps', async () => {
    const id = await startFrom(template())
    const w = (await db.workouts.get(id))!
    expect(w.exercises[0].sets.map((s) => [s.type, s.weight, s.reps, s.done])).toEqual([
      ['warmup', 60, 5, false],
      ['normal', 100, 5, false],
      ['normal', 90, 8, false],
    ])
    // Empty template values stay empty, so last time's values show as placeholders.
    expect(w.exercises[1].sets[0].weight).toBeNull()
  })

  it('only counts edits to exercises, sets or rests as changes, not unticked sets', async () => {
    const t = template()
    const id = await startFrom(t)
    let w = (await db.workouts.get(id))!
    expect(differsFromTemplate(w, t)).toBe(false)

    await mutateWorkout(id, (x) => {
      x.exercises[0].sets[1].done = true
      x.exercises[0].sets[1].weight = 105
    })
    w = (await db.workouts.get(id))!
    expect(differsFromTemplate(w, t)).toBe(false)

    const variants: ((x: typeof w) => void)[] = [
      (x) => (x.exercises[0].restSeconds = 150),
      (x) => (x.exercises[0].sets[2].type = 'drop'),
      (x) => x.exercises[0].sets.pop(),
      (x) => x.exercises.reverse(),
      (x) => x.exercises.pop(),
    ]
    for (const change of variants) {
      const copy = structuredClone(w)
      change(copy)
      expect(differsFromTemplate(copy, t)).toBe(true)
    }
  })

  it('copies the values of completed sets by kind of set, in order', () => {
    const t = template()
    const w = {
      id: 'w',
      name: 'Pierna',
      startedAt: 0,
      endedAt: null,
      source: 'app' as const,
      exerciseIds: ['squat'],
      exercises: [
        {
          exerciseId: 'squat',
          restSeconds: 180,
          // An extra warm-up first: the working sets still match the template's working sets.
          sets: [
            { type: 'warmup' as const, weight: 40, reps: 5, done: true },
            { type: 'warmup' as const, weight: 70, reps: 3, done: true },
            { type: 'normal' as const, weight: 102.5, reps: 5, done: true },
            { type: 'normal' as const, weight: 95, reps: 6, done: false },
          ],
        },
      ],
    }
    const next = templateWithValues(t, w)
    expect(next.exercises[0].sets).toEqual([
      { type: 'warmup', weight: 40, reps: 5 },
      { type: 'normal', weight: 102.5, reps: 5 },
      // Not ticked: keeps the template's values.
      { type: 'normal', weight: 90, reps: 8 },
    ])
    // Exercises not done today are left alone.
    expect(next.exercises[1]).toEqual(t.exercises[1])
  })

  it('always saves the new weights, and the structure only when asked', async () => {
    const id = await startFrom(template())
    await mutateWorkout(id, (x) => {
      x.exercises[0].sets.forEach((s) => (s.done = true))
      x.exercises[0].sets[1].weight = 105
      x.exercises[0].sets.push({ type: 'normal', weight: 80, reps: 10, done: true })
    })
    const w = (await db.workouts.get(id))!

    await syncTemplate(w, 'pierna', false)
    let t = (await db.templates.get('pierna'))!
    expect(t.exercises[0].sets.map((s) => s.weight)).toEqual([60, 105, 90])

    await syncTemplate(w, 'pierna', true)
    t = (await db.templates.get('pierna'))!
    expect(t.exercises[0].sets.map((s) => s.weight)).toEqual([60, 105, 90, 80])
    // The bench press wasn't done but stays in the template, with its empty set.
    expect(t.exercises.map((e) => e.exerciseId)).toEqual(['squat', 'bench'])
    expect(t.exercises[1].sets).toEqual([{ type: 'normal', weight: null, reps: null }])
  })
})

