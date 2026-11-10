import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, type Exercise } from '../db'
import { importStrongCsv } from '../lib/backup'
import { parseCsv } from '../lib/csv'
import { missingFields, strongName } from '../lib/exercises'
import {
  parseStrongCsv,
  parseStrongDate,
  parseStrongDuration,
  workoutsToStrongCsv,
} from '../lib/strong'

// Same shape as a real Strong export (anonymised values).
const SAMPLE = `﻿Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2026-11-03 17:16:24,"Empuje A",1h 44m,"Bench Press (Dumbbell)",W,22.0,10.0,0,0.0,"Primera 5-6, después 6-8\\n","Buen día",
2026-11-03 17:16:24,"Empuje A",1h 44m,"Bench Press (Dumbbell)",Rest Timer,0,0.0,0,90.0,,,
2026-11-03 17:16:24,"Empuje A",1h 44m,"Bench Press (Dumbbell)",1,34.0,6.0,0,0.0,,,
2026-11-03 17:16:24,"Empuje A",1h 44m,"Bench Press (Dumbbell)",Rest Timer,0,0.0,0,180.0,,,
2026-11-03 17:16:24,"Empuje A",1h 44m,"Bench Press (Dumbbell)",2,32.5,7.0,0,0.0,,,8.5
2026-11-03 17:16:24,"Empuje A",1h 44m,"Bench Press (Dumbbell)",D,20.0,8.0,0,0.0,,,
2026-11-03 17:16:24,"Empuje A",1h 44m,"Bench Press (Dumbbell)",Rest Timer,0,0.0,0,180.0,,,
2026-11-03 17:16:24,"Empuje A",1h 44m,"Cable Crossover",1,18.0,10.0,0,0.0,"8-10",,
2026-11-03 17:16:24,"Empuje A",1h 44m,"Cable Crossover",2,18.0,7.0,0,0.0,,,
2026-11-03 17:16:24,"Empuje A",1h 44m,"Cable Crossover",1,7.0,12.0,0,0.0,"",,
2026-11-03 17:16:24,"Empuje A",1h 44m,"Pull Up",1,0,8.0,0,0.0,,,
2026-11-05 09:01:00,"Afternoon Workout",45m,"bench press (dumbbell)",1,30.0,8.0,0,0.0,,,
2025-01-10 18:00:00,"Pierna Vieja",2h,"Leg Press",1,100.0,10.0,0,0.0,,,
2025-01-10 18:00:00,"Pierna Vieja",2h,"Mi Ejercicio Raro",1,10.0,10.0,0,0.0,,,
`

// An exercise already on the device, from the catalog: found by its name in Strong.
const existing: Exercise[] = [
  {
    id: 'bench-db',
    name: 'Press de banca',
    equipment: 'Mancuernas',
    laterality: 'Bilateral',
    primary: ['Pectoral'],
    secondary: ['Deltoides anterior', 'Tríceps'],
    strongNames: ['Bench Press (Dumbbell)'],
    createdAt: 0,
  },
]

describe('csv', () => {
  it('handles quotes, embedded commas/newlines and semicolons', () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
    ])
    expect(parseCsv('a;b\r\n"1\n2";3,5\r\n')).toEqual([
      ['a', 'b'],
      ['1\n2', '3,5'],
    ])
  })
})

describe('Strong CSV import', () => {
  it('parses dates and durations', () => {
    expect(new Date(parseStrongDate('2024-04-15 20:35:10')).getHours()).toBe(20)
    expect(parseStrongDuration('1h 45m')).toBe(105 * 60_000)
    expect(parseStrongDuration('45m')).toBe(45 * 60_000)
    expect(parseStrongDuration('2h')).toBe(120 * 60_000)
  })

  it('groups rows into workouts, exercises and sets', () => {
    const { workouts, newExercises } = parseStrongCsv(SAMPLE, existing)
    expect(workouts.map((w) => w.name)).toEqual(['Pierna Vieja', 'Empuje A', 'Afternoon Workout'])

    const w = workouts[1]
    expect(w.source).toBe('strong')
    expect(w.notes).toBe('Buen día')
    expect(w.endedAt! - w.startedAt).toBe(104 * 60_000)
    // Cable Crossover appears twice in a row (set numbers restart) → two blocks.
    expect(w.exercises).toHaveLength(4)

    const bench = w.exercises[0]
    expect(bench.exerciseId).toBe('bench-db') // matched to the existing exercise
    expect(bench.notes).toBe('Primera 5-6, después 6-8')
    expect(bench.restSeconds).toBe(180) // most frequent rest timer
    expect(bench.sets.map((s) => s.type)).toEqual(['warmup', 'normal', 'normal', 'drop'])
    // Each set keeps the rest after it; with rest timers in the workout, a set without one had none.
    expect(bench.sets.map((s) => s.rest)).toEqual([90, 180, 0, 180])
    expect(bench.sets[2]).toMatchObject({ weight: 32.5, reps: 7, rpe: 8.5, done: true })

    const [, cross1, cross2, pullUp] = w.exercises
    expect(cross1.sets).toHaveLength(2)
    expect(cross1.notes).toBe('8-10')
    expect(cross2.sets).toHaveLength(1)
    expect(cross2.exerciseId).toBe(cross1.exerciseId)
    expect(pullUp.sets[0]).toMatchObject({ weight: 0, reps: 8 })

    // Case-insensitive match: "bench press (dumbbell)" is the same exercise.
    expect(workouts[2].exercises[0].exerciseId).toBe('bench-db')
    // A workout without rest timers says nothing about rests.
    expect(workouts[2].exercises[0].sets[0].rest).toBeUndefined()

    // New exercises come from the catalog, in Spanish; one not in it keeps its name and lacks the rest.
    expect(newExercises.map((e) => e.name).sort()).toEqual(['Cruce de poleas', 'Dominadas', 'Mi Ejercicio Raro', 'Prensa'])
    const legPress = newExercises.find((e) => e.name === 'Prensa')!
    expect(legPress).toMatchObject({ equipment: 'Máquina de discos', laterality: 'Bilateral', primary: ['Cuádriceps', 'Glúteos'] })
    expect(legPress.strongNames).toContain('Leg Press')
    expect(workouts[0].exercises[0].exerciseId).toBe(legPress.id)
    const odd = newExercises.find((e) => e.name === 'Mi Ejercicio Raro')!
    expect(missingFields(odd)).toEqual(['material', 'lateralidad', 'músculos principales', 'músculos secundarios'])
  })

  it('rejects files that are not Strong exports', () => {
    expect(() => parseStrongCsv('foo,bar\n1,2\n', [])).toThrow(/CSV de Strong/)
    expect(() => parseStrongCsv('', [])).toThrow(/vacío/)
  })

  it('round-trips through the Strong CSV export', () => {
    const { workouts, newExercises } = parseStrongCsv(SAMPLE, existing)
    const names = new Map([...existing, ...newExercises].map((e) => [e.id, strongName(e)]))
    const csv = workoutsToStrongCsv(workouts, names)
    const again = parseStrongCsv(csv, [...existing, ...newExercises])
    expect(again.newExercises).toEqual([])
    const shape = (ws: typeof workouts) =>
      ws.map((w) => ({
        id: w.id,
        start: w.startedAt,
        end: w.endedAt,
        notes: w.notes,
        ex: w.exercises.map((e) => ({ id: e.exerciseId, notes: e.notes, sets: e.sets })),
      }))
    expect(shape(again.workouts)).toEqual(shape(workouts))
  })
})

describe('importStrongCsv (database)', () => {
  beforeEach(async () => {
    await Promise.all([db.workouts.clear(), db.exercises.clear(), db.templates.clear()])
    await db.exercises.bulkAdd(existing)
  })

  it('imports once, skips duplicates on re-import and makes no templates', async () => {
    const first = await importStrongCsv(SAMPLE)
    expect(first).toEqual({ added: 3, skipped: 0, newExercises: 4 })
    const second = await importStrongCsv(SAMPLE)
    expect(second).toEqual({ added: 0, skipped: 3, newExercises: 0 })
    expect(await db.workouts.count()).toBe(3)
    expect(await db.exercises.count()).toBe(5)
    expect(await db.templates.count()).toBe(0)
  })
})

// Optional check against a real export: STRONG_CSV=/path/to/strong.csv npm test
const realCsv = process.env.STRONG_CSV
describe.runIf(realCsv)('real Strong export', () => {
  it('parses every row', () => {
    const text = readFileSync(realCsv!, 'utf8')
    const { workouts, newExercises } = parseStrongCsv(text, [])
    const rows = parseCsv(text).slice(1)
    const setRows = rows.filter((r) => !/^rest/i.test(r[4] ?? ''))
    const sets = workouts.reduce((n, w) => n + w.exercises.reduce((m, e) => m + e.sets.length, 0), 0)
    expect(sets).toBe(setRows.length)
    console.log(`${workouts.length} entrenos, ${newExercises.length} ejercicios, ${sets} series`)
  })
})
