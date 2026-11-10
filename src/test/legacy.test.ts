import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { db, type Template, type Workout, type WorkoutSet } from '../db'
import { expandSides, expandWorkoutSides } from '../lib/legacy'

// Sets saved when a unilateral set was one row for both sides.
const twoSided = (extra: object): WorkoutSet => ({ type: 'normal', weight: 15, reps: 10, done: true, sides: 2, ...extra }) as WorkoutSet

describe('sets with two sides in one row', () => {
  it('become one set per side', () => {
    expect(
      expandSides([
        { type: 'warmup', weight: 10, reps: 12, done: true },
        twoSided({ rest: 90, sideRest: 0, second: { weight: 15, reps: 8 }, range: [8, 10] }),
      ]),
    ).toEqual([
      { type: 'warmup', weight: 10, reps: 12, done: true },
      // The first side rests what was the rest between the sides.
      { type: 'normal', weight: 15, reps: 10, done: true, rest: 0, range: [8, 10] },
      { type: 'normal', weight: 15, reps: 8, done: true, rest: 90, range: [8, 10] },
    ])
  })

  it('keep the rest of the set between the sides when there was none, and a first side ticked alone', () => {
    expect(expandSides([twoSided({ rest: 60 })]).map((s) => s.rest)).toEqual([60, 60])
    expect(expandSides([twoSided({})])).toEqual([
      { type: 'normal', weight: 15, reps: 10, done: true },
      { type: 'normal', weight: 15, reps: 10, done: true },
    ])
    expect(expandSides([twoSided({ done: false, firstDone: true })]).map((s) => s.done)).toEqual([true, false])
  })

  it('leave everything else as it was', () => {
    const sets: WorkoutSet[] = [{ type: 'normal', weight: 60, reps: 8, done: true }]
    expect(expandSides(sets)).toBe(sets)
    const w: Workout = {
      id: 'w',
      name: 'Pierna',
      startedAt: 0,
      endedAt: 1,
      source: 'app',
      exerciseIds: ['squat'],
      exercises: [{ exerciseId: 'squat', restSeconds: 120, sets }],
    }
    expect(expandWorkoutSides(w)).toBe(w)
  })

  it('are split when the app opens a database saved with them', async () => {
    const old = new Dexie('strong2')
    old.version(1).stores({ exercises: 'id, &name', workouts: 'id, startedAt, templateId, *exerciseIds', templates: 'id, name, updatedAt' })
    const template = {
      id: 't',
      name: 'Brazo',
      updatedAt: 0,
      exercises: [{ exerciseId: 'curl', restSeconds: 90, sets: [{ type: 'normal', weight: 15, reps: 10, rest: 90, sides: 2, sideRest: 0 }] }],
    }
    const workout = {
      id: 'w',
      name: 'Brazo',
      startedAt: 0,
      endedAt: 1,
      source: 'app',
      exerciseIds: ['curl'],
      exercises: [{ exerciseId: 'curl', restSeconds: 90, sets: [twoSided({ second: { weight: 15, reps: 9 } })] }],
    }
    await old.table('templates').add(template)
    await old.table('workouts').add(workout)
    old.close()

    await db.open()
    const t = (await db.templates.get('t')) as Template
    expect(t.exercises[0].sets).toEqual([
      { type: 'normal', weight: 15, reps: 10, rest: 0 },
      { type: 'normal', weight: 15, reps: 10, rest: 90 },
    ])
    const w = (await db.workouts.get('w')) as Workout
    expect(w.exercises[0].sets.map((s) => [s.reps, s.done])).toEqual([
      [10, true],
      [9, true],
    ])
  })
})
