import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, type Workout, type WorkoutSet } from '../db'
import { parseStrongCsv } from '../lib/strong'
import { exerciseContext, improves, sameSets, stalledFor, stalledSessions, STALL_SESSIONS } from '../lib/workouts'

const set = (weight: number | null, reps: number | null, type: WorkoutSet['type'] = 'normal', done = true): WorkoutSet => ({
  type,
  weight,
  reps,
  done,
})

describe('the same set in another session', () => {
  it('pairs sets of the same kind in order, and working sets by position', () => {
    const before = [set(40, 10, 'warmup'), set(100, 6, 'top'), set(90, 8, 'backoff'), set(90, 8, 'backoff')]
    const now = [set(40, 10, 'warmup'), set(100, 7, 'top'), set(90, 8, 'backoff'), set(90, 9, 'backoff'), set(90, 7, 'backoff')]
    expect(sameSets(now, before)).toEqual([before[0], before[1], before[2], before[3], undefined])
    // Logged as normal sets last time: a top set then back offs take them by position.
    const plain = [set(100, 6), set(90, 8)]
    expect(sameSets([set(100, 7, 'top'), set(90, 8, 'backoff')], plain)).toEqual([plain[0], plain[1]])
  })
})

describe('improving', () => {
  const last = [[set(80, 8), set(80, 7)]]

  it('counts more weight, even with fewer reps, or more reps', () => {
    expect(improves([set(82.5, 6), set(80, 7)], last)).toBe(true) // more weight, fewer reps
    expect(improves([set(80, 8), set(80, 8)], last)).toBe(true) // one more rep in the second set
    expect(improves([set(75, 9), set(80, 7)], last)).toBe(true) // more reps with less weight
    expect(improves([set(80, 8), set(80, 7)], last)).toBe(false) // the same
    expect(improves([set(77.5, 8), set(80, 6)], last)).toBe(false) // worse
  })

  it('needs to beat each of the sessions before, not just a bad day', () => {
    const before = [[set(80, 8)], [set(80, 6)]]
    expect(improves([set(80, 7)], before)).toBe(false) // better than the bad day only
    expect(improves([set(80, 9)], before)).toBe(true)
  })

  it('ignores warm-ups, sets not done yet, sets without reps and sets with nothing to compare', () => {
    expect(improves([set(100, 10, 'warmup')], last)).toBe(false)
    expect(improves([set(100, 10, 'normal', false)], last)).toBe(false)
    expect(improves([set(100, null)], last)).toBe(false)
    expect(improves([set(80, 8), set(80, 7), set(100, 10)], last)).toBe(false) // a third set: nothing to beat
    expect(improves([set(80, 9)], [])).toBe(false)
  })

  it('works with bodyweight exercises', () => {
    expect(improves([set(null, 11)], [[set(null, 10)]])).toBe(true)
    expect(improves([set(0, 10)], [[set(null, 10)]])).toBe(false)
  })
})

describe('stalled', () => {
  it('counts the sessions in a row, up to the last, that did not beat the ones before', () => {
    const same = [set(80, 8)]
    expect(stalledSessions([same, same, same, same, same])).toBe(4)
    expect(stalledSessions([same, same, same, same])).toBe(3)
    // Reps up, then weight up (reps down): each one improves.
    expect(stalledSessions([[set(80, 6)], [set(80, 7)], [set(80, 8)], [set(82.5, 6)]])).toBe(0)
    // After the last improvement, four sessions at the same numbers.
    const progress = [[set(80, 6)], [set(80, 7)], [set(80, 8)], [set(82.5, 6)]]
    expect(stalledSessions([...progress, [set(82.5, 6)], [set(82.5, 6)], [set(82.5, 6)], [set(82.5, 6)]])).toBe(4)
    // A bad day and back to the usual is not an improvement.
    expect(stalledSessions([[set(80, 8)], [set(80, 6)], [set(80, 8)]])).toBe(2)
  })

  const day = (d: number, sets: WorkoutSet[], exerciseId = 'curl'): Workout => {
    const startedAt = new Date(2026, 9, d, 18).getTime()
    return {
      id: `w${d}`,
      name: 'Brazo',
      startedAt,
      endedAt: startedAt + 3_600_000,
      source: 'app',
      exercises: [{ exerciseId, restSeconds: 90, sets }],
      exerciseIds: [exerciseId],
    }
  }

  beforeEach(async () => {
    await db.workouts.clear()
    // Five sessions at 20 × 10 after one at 20 × 9: four without improving.
    await db.workouts.bulkAdd([9, 11, 13, 15, 17, 19].map((d, i) => day(d, [set(10, 12, 'warmup'), set(20, i === 0 ? 9 : 10), set(20, 8)])))
  })

  it('shows in the workout until a set beats the sessions before', async () => {
    const ctx = await exerciseContext('curl', 'now', new Date(2026, 9, 21, 18).getTime())
    expect(ctx.stalled).toBe(4)
    expect(ctx.recent).toHaveLength(STALL_SESSIONS)
    const today = [set(10, 12, 'warmup'), set(20, null, 'normal', false), set(20, null, 'normal', false)]
    expect(stalledFor(today, ctx)).toBe(4)
    today[1] = set(20, 10) // the same as always
    expect(stalledFor(today, ctx)).toBe(4)
    today[2] = set(20, 9) // one more rep in the second set
    expect(stalledFor(today, ctx)).toBe(0)
  })

  it('needs four sessions without improving', async () => {
    const ctx = await exerciseContext('curl', 'now', new Date(2026, 9, 18, 18).getTime())
    expect(ctx.stalled).toBe(3)
    expect(stalledFor([set(20, null, 'normal', false)], ctx)).toBe(0)
  })

  it('leaves timed exercises alone', async () => {
    await db.workouts.bulkAdd([3, 4, 5, 6, 7, 8].map((d) => day(d, [{ type: 'normal', weight: null, reps: null, seconds: 60, done: true }], 'plank')))
    const ctx = await exerciseContext('plank', 'now', new Date(2026, 9, 21).getTime())
    expect(ctx.stalled).toBe(0)
  })
})

// Optional, with a real export: STRONG_CSV=/path/to/strong.csv npm test lists the exercises that
// would show the notice in their next workout.
const realCsv = process.env.STRONG_CSV
describe.runIf(realCsv)('stalled exercises in a real export', () => {
  it('lists them', async () => {
    const { workouts, newExercises } = parseStrongCsv(readFileSync(realCsv!, 'utf8'), [])
    await db.workouts.clear()
    await db.workouts.bulkAdd(workouts)
    const name = new Map(newExercises.map((e) => [e.id, e.name]))
    const last = new Map<string, number>()
    for (const w of workouts) for (const id of w.exerciseIds) last.set(id, w.startedAt)
    const recent = [...last].filter(([, at]) => at > Date.now() - 60 * 86_400_000).map(([id]) => id)
    const found: string[] = []
    for (const id of recent) {
      const ctx = await exerciseContext(id, 'next', Date.now())
      if (ctx.stalled >= STALL_SESSIONS) found.push(`${name.get(id)} (${ctx.stalled})`)
    }
    console.log(`estancados (de ${recent.length} ejercicios de los últimos 60 días): ${found.join(', ') || 'ninguno'}`)
    expect(found.length).toBeLessThanOrEqual(recent.length)
  })
})
