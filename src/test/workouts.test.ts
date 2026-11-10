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
  startWorkout,
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
})
