import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { db, type Template, type Workout } from '../db'
import { restoreBackup } from '../lib/backup'
import { CATALOG_EXERCISES } from '../lib/catalog'

const workouts: Workout[] = [
  {
    id: 'w1',
    name: 'Pierna',
    startedAt: 1,
    endedAt: 2,
    source: 'strong',
    exercises: [
      { exerciseId: 'press', restSeconds: 120, sets: [{ type: 'normal', weight: 100, reps: 10, done: true }] },
      { exerciseId: 'abductions', restSeconds: 90, sets: [{ type: 'normal', weight: 40, reps: 12, done: true }] },
    ],
    exerciseIds: ['press', 'abductions'],
  },
  {
    id: 'w2',
    name: 'Pierna',
    startedAt: 3,
    endedAt: 4,
    source: 'strong',
    exercises: [{ exerciseId: 'abductor', restSeconds: 90, sets: [{ type: 'normal', weight: 45, reps: 10, done: true }] }],
    exerciseIds: ['abductor'],
  },
  ...[5, 7].map((startedAt) => ({
    id: `w${startedAt}`,
    name: 'Pierna',
    startedAt,
    endedAt: startedAt + 1,
    source: 'strong' as const,
    exercises: [{ exerciseId: 'abductor', restSeconds: 90, sets: [{ type: 'normal' as const, weight: 45, reps: 10, done: true }] }],
    exerciseIds: ['abductor'],
  })),
]
const templates: Template[] = [
  { id: 't1', name: 'Pierna', updatedAt: 0, exercises: [{ exerciseId: 'abductions', restSeconds: 90, sets: [{ type: 'normal', weight: 40, reps: 12 }] }] },
]
const exercises = [
  { id: 'press', name: 'Leg Press', category: 'Pierna', createdAt: 0 },
  { id: 'abductor', name: 'Hip Abductor (Machine)', category: 'Pierna', createdAt: 0 },
  { id: 'abductions', name: 'Glute Abductions (Machine)', category: 'Pierna', createdAt: 0 },
  { id: 'mine', name: 'Mi ejercicio', createdAt: 0 },
]

/** What a device with the app before the catalog has, after the upgrade or restoring its backup. */
async function expectMigrated() {
  const byId = new Map((await db.exercises.toArray()).map((e) => [e.id, e]))
  expect(byId.size).toBe(CATALOG_EXERCISES.length + 1) // the catalog and «Mi ejercicio»
  expect(byId.get('press')).toMatchObject({ name: 'Prensa', equipment: 'Máquina de discos' })
  expect(byId.get('press')).not.toHaveProperty('category')
  expect(byId.get('mine')).toEqual({ id: 'mine', name: 'Mi ejercicio', createdAt: 0 })
  // The two abductor machines were the same one: the most used stays (3 workouts against 1 and a template).
  expect(byId.has('abductions')).toBe(false)
  expect(byId.get('abductor')?.strongNames).toEqual(['Hip Abductor (Machine)', 'Glute Abductions (Machine)'])

  const after = await db.workouts.orderBy('startedAt').toArray()
  expect(after.map((w) => w.exerciseIds)).toEqual([['press', 'abductor'], ['abductor'], ['abductor'], ['abductor']])
  expect(after[0].exercises[1].sets).toEqual(workouts[0].exercises[1].sets)
  expect(await db.workouts.where('exerciseIds').equals('abductor').count()).toBe(4)
  expect((await db.templates.get('t1'))?.exercises[0].exerciseId).toBe('abductor')
  // Two exercises can now share a name.
  expect(await db.exercises.where('name').equals('Press de banca').count()).toBe(2)
}

describe('before the catalog', () => {
  it('the database upgrade moves the exercises to the catalog, losing nothing', async () => {
    const old = new Dexie('strong2')
    old.version(2).stores({
      exercises: 'id, &name',
      workouts: 'id, startedAt, templateId, *exerciseIds',
      templates: 'id, name, updatedAt',
    })
    await old.table('exercises').bulkAdd(exercises)
    await old.table('workouts').bulkAdd(workouts)
    await old.table('templates').bulkAdd(templates)
    old.close()

    await db.open()
    expect(db.verno).toBe(3)
    await expectMigrated()
  })

  it('a backup from then is restored the same way', async () => {
    await db.exercises.clear()
    const backup = { app: 'strong2', version: 1, exportedAt: 0, exercises, workouts, templates }
    expect(await restoreBackup(JSON.stringify(backup))).toEqual({ workouts: 4 })
    await expectMigrated()
  })
})
