import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, type Exercise, type Workout, type WorkoutSet } from '../db'
import { columnTicks, fmtTick, niceTicks } from '../lib/chartScale'
import {
  exerciseSessions,
  personalRecords,
  realSets,
  volume,
  weeklyStats,
  weekStart,
  weekStarts,
  workoutPRCounts,
} from '../lib/stats'
import { exerciseContext, isPR } from '../lib/workouts'

const set = (weight: number, reps: number, type: WorkoutSet['type'] = 'normal'): WorkoutSet => ({ type, weight, reps, done: true })

function workout(id: string, day: number, sets: WorkoutSet[], exerciseId = 'bench'): Workout {
  const startedAt = new Date(2026, 0, day, 18).getTime()
  return {
    id,
    name: 'Pecho',
    startedAt,
    endedAt: startedAt + 3_600_000,
    source: 'app',
    exercises: [{ exerciseId, restSeconds: 120, sets }],
    exerciseIds: [exerciseId],
  }
}

const history = [
  workout('a', 5, [set(40, 10, 'warmup'), set(80, 5), set(80, 5)]),
  workout('b', 7, [set(85, 5), set(70, 12)]),
  workout('c', 9, [set(85, 3)]), // no record
  workout('d', 12, [set(90, 2)]), // heavier weight → record
]

describe('exercise stats', () => {
  it('derives per-session metrics, ignoring warm-ups', () => {
    const s = exerciseSessions(history, 'bench')
    expect(s.map((x) => x.workoutId)).toEqual(['a', 'b', 'c', 'd'])
    expect(s[0].maxWeight).toBe(80)
    expect(s[0].volume).toBe(800)
    expect(s[0].e1rm).toBeCloseTo(80 * (1 + 5 / 30))
    expect(s[1].maxReps).toBe(12)
  })

  it('adds up the volume of a workout, without warm-ups', () => {
    expect(volume(history[0])).toBe(800)
  })

  it('finds personal records and rep maxes', () => {
    const r = personalRecords(exerciseSessions(history, 'bench'))
    expect(r.maxWeight?.value).toBe(90)
    expect(r.maxWeight?.workoutId).toBe('d')
    expect(r.e1rm?.workoutId).toBe('b') // 85×5 ≈ 99.2 beats 90×2 = 96
    expect(r.maxReps?.value).toBe(12)
    expect(r.maxVolume?.value).toBe(85 * 5 + 70 * 12)
    const rm = Object.fromEntries(r.repMaxes.map((x) => [x.reps, x.weight]))
    expect(rm[1]).toBe(90)
    expect(rm[3]).toBe(85)
    expect(rm[5]).toBe(85)
    expect(rm[6]).toBe(70)
    expect(rm[12]).toBe(70)
  })

  it('counts records per workout, not counting first sessions', () => {
    const prs = workoutPRCounts(history)
    expect(prs.get('a')).toBeUndefined()
    expect(prs.get('b')).toBe(1)
    expect(prs.get('c')).toBeUndefined()
    expect(prs.get('d')).toBe(1)
  })

  it('starts weeks on Monday', () => {
    const monday = new Date(2026, 0, 12).getTime() // Monday 12 Jan 2026
    expect(weekStart(new Date(2026, 0, 18, 23).getTime())).toBe(monday)
    expect(weekStarts(3, new Date(2026, 0, 14).getTime())).toEqual([
      new Date(2025, 11, 29).getTime(),
      new Date(2026, 0, 5).getTime(),
      monday,
    ])
  })
})

describe('weekly stats', () => {
  const exercises: Exercise[] = [
    { id: 'bench', name: 'Press de banca', laterality: 'Bilateral', primary: ['Pectoral'], secondary: ['Tríceps'], createdAt: 0 },
    { id: 'row', name: 'Remo', laterality: 'Unilateral', primary: ['Dorsal ancho', 'Romboides'], secondary: [], createdAt: 0 },
    { id: 'mine', name: 'Mi ejercicio', createdAt: 0 },
  ]
  const day = (date: number, entries: [string, WorkoutSet[]][], minutes = 60): Workout => ({
    ...workout(`w${date}`, date, []),
    endedAt: new Date(2026, 0, date, 18).getTime() + minutes * 60_000,
    exercises: entries.map(([exerciseId, sets]) => ({ exerciseId, restSeconds: 90, sets })),
    exerciseIds: entries.map(([id]) => id),
  })
  const sides = (n: number) => Array.from({ length: n }, () => set(20, 10))

  it('counts real sets: done, without warm-ups, a pair of sides as one', () => {
    const sets = [set(40, 10, 'warmup'), set(60, 8), set(60, 8), { ...set(60, 8), done: false }]
    expect(realSets(sets, false)).toBe(2)
    expect(realSets(sides(6), true)).toBe(3)
    expect(realSets(sides(5), true)).toBe(3) // one side more on the last set
  })

  it('adds up each week, and the sets of each primary muscle', () => {
    const workouts = [
      day(-11, [['bench', [set(60, 8)]]]), // 20 Dec, before the weeks shown
      day(5, [
        ['bench', [set(40, 10, 'warmup'), set(80, 5), set(80, 5), set(80, 5)]],
        ['row', sides(6)],
        ['mine', [set(10, 10), set(10, 10)]],
      ]),
      day(7, [['bench', [set(85, 5), set(85, 5)]]], 30),
      { ...day(13, [['bench', [set(90, 3)]]]), endedAt: null }, // in progress
    ]
    const [before, week, current] = weeklyStats(workouts, exercises, 3, new Date(2026, 0, 14).getTime())
    expect(before.workouts).toBe(0)
    expect(current).toMatchObject({ workouts: 0, sets: 0, volume: 0 })
    expect(week).toMatchObject({
      week: new Date(2026, 0, 5).getTime(),
      workouts: 2,
      sets: 3 + 3 + 2 + 2,
      volume: 3 * 400 + 6 * 200 + 2 * 100 + 2 * 425,
      duration: 90 * 60_000,
      unassigned: 2,
    })
    // Each exercise counts for each of its primary muscles; secondary muscles don't count.
    expect(Object.entries(week.muscles).filter(([, n]) => n > 0)).toEqual([
      ['Pectoral', 5],
      ['Dorsal ancho', 3],
      ['Romboides', 3],
    ])
  })
})

describe('records while logging', () => {
  beforeEach(async () => {
    await db.workouts.clear()
    await db.workouts.bulkAdd(history)
  })

  it('compares against earlier sessions only', async () => {
    const ctx = await exerciseContext('bench', 'new', new Date(2026, 0, 10).getTime())
    expect(ctx.sessions).toBe(3)
    expect(ctx.bestWeight).toBe(85)
    expect(ctx.last?.sets).toEqual([set(85, 3)])
    expect(isPR(set(87.5, 1), ctx)).toBe(true) // heavier
    expect(isPR(set(80, 9), ctx)).toBe(true) // better estimated 1RM
    expect(isPR(set(80, 5), ctx)).toBe(false)
    expect(isPR({ ...set(100, 5), done: false }, ctx)).toBe(false)
    expect(isPR(set(100, 5, 'warmup'), ctx)).toBe(false)

    const first = await exerciseContext('squat', 'new', Date.now())
    expect(isPR(set(100, 5), first)).toBe(false) // nothing to beat yet
  })
})

describe('chart scale', () => {
  it('picks round ticks', () => {
    expect(niceTicks(83, 101).ticks).toEqual([80, 85, 90, 95, 100, 105])
    expect(niceTicks(0, 4).ticks).toEqual([0, 1, 2, 3, 4])
    expect(niceTicks(50, 50).ticks.length).toBeGreaterThan(1)
    expect(fmtTick(12500)).toBe('12,5K')
    expect(fmtTick(2500)).toBe('2500')
    expect(fmtTick(97.5)).toBe('97,5')
  })

  it('counts columns in whole steps from zero', () => {
    expect(columnTicks(0, true)).toEqual({ top: 1, ticks: [0, 1] })
    expect(columnTicks(2, true).ticks).toEqual([0, 1, 2])
    expect(columnTicks(5, true).ticks).toEqual([0, 2, 4, 6])
    expect(columnTicks(9, true).ticks).toEqual([0, 3, 6, 9])
    expect(columnTicks(12540, false)).toEqual({ top: 15000, ticks: [0, 5000, 10000, 15000] })
    expect(columnTicks(5.2, false).ticks).toEqual([0, 2, 4, 6])
  })
})
