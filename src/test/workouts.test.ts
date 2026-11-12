import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, newId, type Template } from '../db'
import {
  addExercisesToWorkout,
  finishWorkout,
  getActiveWorkout,
  lastPerformance,
  mutateWorkout,
  nextSet,
  saveWorkout,
  startWorkout,
  structureChanged,
  syncTemplate,
  templateChanges,
  templateWithValues,
  valuesChanged,
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
    expect(structureChanged(templateChanges(w, t))).toBe(false)
    await mutateWorkout(id, (x) => x.exercises[0].sets.push({ type: 'normal', weight: 100, reps: 5, done: true }))
    w = (await db.workouts.get(id))!
    expect(templateChanges(w, t).addedSets).toBe(1)
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

  it('tells what would change in the template: values of ticked sets, exercises, sets and rests', async () => {
    const t = template()
    const id = await startFrom(t)
    let w = (await db.workouts.get(id))!
    const nothing = templateChanges(w, t)
    expect(valuesChanged(nothing) || structureChanged(nothing)).toBe(false)

    // Ticking a set as it was is no change; with another weight, it changes its values.
    await mutateWorkout(id, (x) => {
      x.exercises[0].sets[0].done = true
      x.exercises[0].sets[1].done = true
      x.exercises[0].sets[1].weight = 105
      x.exercises[0].sets[2].weight = 95 // not ticked: not a change
    })
    w = (await db.workouts.get(id))!
    expect(templateChanges(w, t)).toMatchObject({ values: 1, notes: 0 })
    expect(structureChanged(templateChanges(w, t))).toBe(false)

    const variants: [(x: typeof w) => void, Partial<ReturnType<typeof templateChanges>>][] = [
      [(x) => (x.exercises[0].restSeconds = 150), { rests: true }],
      [(x) => (x.exercises[0].sets[2].rest = 60), { rests: true }],
      [(x) => (x.exercises[0].sets[2].type = 'drop'), { setTypes: 1 }],
      [(x) => x.exercises[0].sets.pop(), { removedSets: 1 }],
      [(x) => x.exercises[1].sets.push({ type: 'normal', weight: null, reps: null, done: false }), { addedSets: 1 }],
      [(x) => x.exercises.reverse(), { order: true }],
      [(x) => x.exercises.pop(), { removedExercises: 1 }],
      [(x) => x.exercises.push({ exerciseId: 'bench', restSeconds: 60, sets: [] }), { addedExercises: 1 }],
      [(x) => (x.exercises[0].stickyNote = 'Barra baja'), { notes: 1 }],
    ]
    for (const [change, expected] of variants) {
      const copy = structuredClone(w)
      change(copy)
      expect(templateChanges(copy, t)).toMatchObject(expected)
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

  it('takes only the values, or the template and values, as chosen', async () => {
    const id = await startFrom(template())
    await mutateWorkout(id, (x) => {
      x.exercises[0].sets.forEach((s) => (s.done = true))
      x.exercises[0].sets[1].weight = 105
      x.exercises[0].sets.push({ type: 'normal', weight: 80, reps: 10, done: true })
    })
    const w = (await db.workouts.get(id))!

    await syncTemplate(w, 'pierna', 'values')
    let t = (await db.templates.get('pierna'))!
    expect(t.exercises[0].sets.map((s) => s.weight)).toEqual([60, 105, 90])

    await syncTemplate(w, 'pierna', 'all')
    t = (await db.templates.get('pierna'))!
    expect(t.exercises[0].sets.map((s) => s.weight)).toEqual([60, 105, 90, 80])
    // The bench press wasn't done but stays in the template, with its empty set.
    expect(t.exercises.map((e) => e.exerciseId)).toEqual(['squat', 'bench'])
    expect(t.exercises[1].sets).toEqual([{ type: 'normal', weight: null, reps: null }])
  })
})


describe('rests per set, target reps and notes', () => {
  const ext = { id: 'ext', name: 'Unilateral Triceps Extension (Cable)', createdAt: 0 }
  const template = (): Template => ({
    id: 'empuje',
    name: 'Empuje',
    updatedAt: 0,
    exercises: [
      {
        exerciseId: 'bench',
        restSeconds: 180,
        stickyNote: '52 de altura',
        notes: 'Hacerlo sentado',
        sets: [
          { type: 'warmup', weight: 20, reps: 6, rest: 60 },
          { type: 'top', weight: 95, reps: 5, rest: 210, range: [4, 6] },
          { type: 'backoff', weight: 85, reps: 7, rest: 180, range: [6, 8] },
        ],
      },
      {
        // Unilateral, one set per side as in Strong: no rest between the sides.
        exerciseId: 'ext',
        restSeconds: 90,
        sets: [
          { type: 'normal', weight: 16.25, reps: 10, rest: 0, range: [9, 12] },
          { type: 'normal', weight: 16.25, reps: 10, rest: 90, range: [9, 12] },
        ],
      },
    ],
  })

  beforeEach(async () => {
    await db.exercises.add(ext)
  })

  async function startFrom(t: Template) {
    await db.templates.put(t)
    return startWorkout(t)
  }

  it('starts with the rests, targets and notes of the template', async () => {
    const w = (await db.workouts.get(await startFrom(template())))!
    expect(w.exercises[0]).toMatchObject({ stickyNote: '52 de altura', notes: 'Hacerlo sentado' })
    expect(w.exercises[0].sets[1]).toEqual({ type: 'top', weight: 95, reps: 5, rest: 210, range: [4, 6], done: false })
    expect(w.exercises[1].sets.map((s) => s.rest)).toEqual([0, 90])
  })

  it('counts a changed rest as a change to the template, and values or sticky notes apart', async () => {
    const t = template()
    const w = (await db.workouts.get(await startFrom(t)))!
    const changes: [(x: typeof w) => void, boolean, boolean][] = [
      [(x) => (x.exercises[0].sets[1].rest = 200), false, true],
      [(x) => (x.exercises[1].sets[0].rest = 30), false, true],
      [(x) => (x.exercises[0].sets[2].range = [8, 10]), false, true],
      [(x) => delete x.exercises[1].sets[0].range, false, true],
      [(x) => (x.exercises[0].sets[0].range = [6, 6]), false, true],
      [(x) => (x.exercises[0].sets[1].range = [4, 6]), false, false],
      [(x) => Object.assign(x.exercises[1].sets[1], { reps: 9, done: true }), true, false],
      [(x) => (x.exercises[0].stickyNote = '50 de altura'), true, false],
      [(x) => (x.exercises[0].sets[1].done = true), false, false],
    ]
    for (const [change, values, structure] of changes) {
      const copy = structuredClone(w)
      change(copy)
      const c = templateChanges(copy, t)
      expect([valuesChanged(c), structureChanged(c)]).toEqual([values, structure])
    }
  })

  it('tells a deleted set as one set less, not as every set below it changing', async () => {
    const t = template()
    t.exercises[0].sets.unshift({ type: 'warmup', weight: 10, reps: 10, rest: 90 })
    const w = (await db.workouts.get(await startFrom(t)))!
    const cases: [(x: typeof w) => void, Partial<ReturnType<typeof templateChanges>>][] = [
      // The first warm-up (rest 1:30), the second (rest 1:00), the top set, the last set.
      [(x) => x.exercises[0].sets.splice(0, 1), { removedSets: 1, setTypes: 0, rests: false, ranges: false }],
      [(x) => x.exercises[0].sets.splice(1, 1), { removedSets: 1, setTypes: 0, rests: false, ranges: false }],
      [(x) => x.exercises[0].sets.splice(2, 1), { removedSets: 1, setTypes: 0, rests: false, ranges: false }],
      [(x) => x.exercises[1].sets.splice(1, 1), { removedSets: 1, setTypes: 0, rests: false, ranges: false }],
      // Deleted and another kind added; a kind changed in the middle.
      [
        (x) => {
          x.exercises[0].sets.splice(1, 1)
          x.exercises[0].sets.push({ type: 'drop', weight: 60, reps: 10, done: false, rest: 0 })
        },
        { removedSets: 1, addedSets: 1, setTypes: 0, rests: false },
      ],
      [(x) => (x.exercises[0].sets[2].type = 'normal'), { removedSets: 0, addedSets: 0, setTypes: 1, rests: false }],
      // Its rest taken away too: the rest changes.
      [
        (x) => {
          x.exercises[0].sets.splice(0, 1)
          x.exercises[0].sets[0].rest = 0
        },
        { removedSets: 1, setTypes: 0, rests: true },
      ],
    ]
    for (const [change, expected] of cases) {
      const copy = structuredClone(w)
      change(copy)
      expect(templateChanges(copy, t)).toMatchObject(expected)
    }
  })

  it('takes a target range changed during the workout when updating the template', async () => {
    const id = await startFrom(template())
    await mutateWorkout(id, (x) => {
      x.exercises[0].sets[2].range = [8, 10]
      delete x.exercises[1].sets[1].range
    })
    const w = (await db.workouts.get(id))!
    expect(templateChanges(w, template())).toMatchObject({ ranges: true, rests: false, setTypes: 0 })
    // Only the values: the targets stay as they were.
    expect(templateWithValues(template(), w).exercises[0].sets[2].range).toEqual([6, 8])
    await syncTemplate(w, 'empuje', 'all')
    const t = (await db.templates.get('empuje'))!
    expect(t.exercises[0].sets.map((s) => s.range)).toEqual([undefined, [4, 6], [8, 10]])
    expect(t.exercises[1].sets.map((s) => s.range)).toEqual([[9, 12], undefined])
  })

  it('saves values and the sticky note, keeping rests and targets', async () => {
    const id = await startFrom(template())
    await mutateWorkout(id, (x) => {
      x.exercises[0].stickyNote = '50 de altura'
      x.exercises[0].notes = 'Me molestaba el hombro'
      Object.assign(x.exercises[0].sets[1], { weight: 97.5, reps: 4, done: true })
      Object.assign(x.exercises[1].sets[0], { weight: 17.5, reps: 10, done: true })
      Object.assign(x.exercises[1].sets[1], { weight: 17.5, reps: 8, done: true })
    })
    const w = (await db.workouts.get(id))!
    const next = templateWithValues(template(), w)
    expect(next.exercises[0].stickyNote).toBe('50 de altura')
    expect(next.exercises[0].notes).toBe('Hacerlo sentado')
    expect(next.exercises[0].sets[1]).toEqual({ type: 'top', weight: 97.5, reps: 4, rest: 210, range: [4, 6] })
    expect(next.exercises[1].sets).toEqual([
      { type: 'normal', weight: 17.5, reps: 10, rest: 0, range: [9, 12] },
      { type: 'normal', weight: 17.5, reps: 8, rest: 90, range: [9, 12] },
    ])

    // Updating the structure too keeps the template's own notes, not today's.
    await syncTemplate(w, 'empuje', 'all')
    const t = (await db.templates.get('empuje'))!
    expect(t.exercises[0]).toMatchObject({ notes: 'Hacerlo sentado', stickyNote: '50 de altura' })
    expect(t.exercises[0].sets[2]).toMatchObject({ type: 'backoff', rest: 180, range: [6, 8] })
  })

  it('adds sets like the last one: a back off after a top set', async () => {
    const w = (await db.workouts.get(await startFrom(template())))!
    expect(nextSet(w.exercises[0])).toEqual({ type: 'backoff', weight: null, reps: null, done: false, rest: 180, range: [6, 8] })
    expect(nextSet({ exerciseId: 'bench', restSeconds: 60, sets: [{ type: 'warmup', weight: 20, reps: 5, done: true }] }).type).toBe(
      'normal',
    )
    expect(nextSet(w.exercises[1])).toMatchObject({ type: 'normal', rest: 90 })
  })

  it('adds a unilateral exercise with a set per side, like last time', async () => {
    const id = await startFrom(template())
    await mutateWorkout(id, (x) => x.exercises[1].sets.forEach((s) => (s.done = true)))
    await finishWorkout(id)
    const next = await startWorkout()
    await addExercisesToWorkout(next, ['ext'])
    const added = (await db.workouts.get(next))!
    expect(added.exercises[0].sets.map((s) => s.rest)).toEqual([0, 90])
  })
})
