import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { db, type Template, type Workout } from '../db'
import { restoreBackup } from '../lib/backup'
import { addToNote, mergeNotes, mergeTemplateNotes, mergeWorkoutNotes } from '../lib/legacy'

// Saved when an exercise had two notes: the yellow one («Nota fija») and one for the day
// (in a template, one copied into each workout).
const template = {
  id: 't',
  name: 'Empuje',
  updatedAt: 0,
  exercises: [
    { exerciseId: 'bench', restSeconds: 180, stickyNote: '52 de altura', notes: 'Hacerlo despacio', sets: [{ type: 'normal', weight: 60, reps: 8 }] },
    { exerciseId: 'ext', restSeconds: 90, notes: 'Hacerlo sentado', sets: [{ type: 'normal', weight: 15, reps: 12 }] },
    { exerciseId: 'press', restSeconds: 90, stickyNote: 'Asiento 4', sets: [{ type: 'normal', weight: 40, reps: 10 }] },
  ],
}
const workouts = [
  {
    // From Strong: its note is in `notes`.
    id: 'strong',
    name: 'Empuje',
    startedAt: 1,
    endedAt: 2,
    source: 'strong',
    exerciseIds: ['ext'],
    exercises: [{ exerciseId: 'ext', restSeconds: 90, notes: '12-15', sets: [{ type: 'normal', weight: 15, reps: 12, done: true }] }],
  },
  {
    // Both, the same text twice, and a note left empty.
    id: 'app',
    name: 'Empuje',
    startedAt: 3,
    endedAt: 4,
    source: 'app',
    exerciseIds: ['bench', 'ext'],
    exercises: [
      { exerciseId: 'bench', restSeconds: 180, stickyNote: '52 de altura\nHacerlo despacio', notes: 'Hacerlo despacio', sets: [] },
      { exerciseId: 'ext', restSeconds: 90, stickyNote: 'Hacerlo sentado', notes: undefined, sets: [] },
    ],
  },
]

/** What a device with two notes per exercise has after the upgrade or restoring its backup. */
async function expectOneNote() {
  const t = (await db.templates.get('t'))!
  expect(t.exercises.map((e) => e.stickyNote)).toEqual(['52 de altura\nHacerlo despacio', 'Hacerlo sentado', 'Asiento 4'])
  const [strong, app] = await db.workouts.orderBy('startedAt').toArray()
  expect(strong.exercises[0].stickyNote).toBe('12-15')
  expect(app.exercises.map((e) => e.stickyNote)).toEqual(['52 de altura\nHacerlo despacio', 'Hacerlo sentado'])
  for (const e of [...t.exercises, ...strong.exercises, ...app.exercises]) expect(e).not.toHaveProperty('notes')
  // The rest is as it was.
  expect(t.exercises[0].sets).toEqual(template.exercises[0].sets)
  expect(strong.exercises[0].sets).toEqual(workouts[0].exercises[0].sets)
}

describe('one note per exercise', () => {
  it('adds the other note to the yellow one, on a new line, unless it already says it', () => {
    expect(addToNote(undefined, 'Hacerlo sentado')).toBe('Hacerlo sentado')
    expect(addToNote('52 de altura', 'Hacerlo sentado')).toBe('52 de altura\nHacerlo sentado')
    expect(addToNote('52 de altura\nHacerlo sentado', 'Hacerlo sentado')).toBe('52 de altura\nHacerlo sentado')
    expect(addToNote('52 de altura', '  ')).toBe('52 de altura')
    expect(addToNote('', ' 6-8 ')).toBe('6-8')

    const one = template.exercises[2] as Template['exercises'][number]
    expect(mergeNotes(one)).toBe(one)
    const t = template as unknown as Template
    expect(mergeTemplateNotes({ ...t, exercises: [one] })).toEqual({ ...t, exercises: [one] })
    const w = workouts[0] as unknown as Workout
    expect(mergeWorkoutNotes(w).exercises[0]).toEqual({ exerciseId: 'ext', restSeconds: 90, stickyNote: '12-15', sets: w.exercises[0].sets })
  })

  it('are merged when the app opens a database saved with two', async () => {
    const old = new Dexie('strong2')
    old.version(3).stores({ exercises: 'id, name', workouts: 'id, startedAt, templateId, *exerciseIds', templates: 'id, name, updatedAt' })
    await old.table('templates').add(template)
    await old.table('workouts').bulkAdd(workouts)
    old.close()

    await db.open()
    expect(db.verno).toBe(4)
    await expectOneNote()
  })

  it('are merged when restoring a backup saved with two', async () => {
    await Promise.all([db.workouts.clear(), db.templates.clear()])
    const backup = { app: 'strong2', version: 2, exportedAt: 0, exercises: [], workouts, templates: [template] }
    expect(await restoreBackup(JSON.stringify(backup))).toEqual({ workouts: 2 })
    await expectOneNote()
  })
})
