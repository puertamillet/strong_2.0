import { describe, expect, it } from 'vitest'
import type { Template, Workout } from '../db'
import { templateStats } from '../lib/templateStats'

const MIN = 60_000

const template = (id: string, name: string): Template => ({ id, name, exercises: [], updatedAt: 0 })

/** A workout on day `day` of January 2026 that took `minutes` (null: still going). */
function workout(id: string, name: string, day: number, minutes: number | null, templateId?: string): Workout {
  const startedAt = new Date(2026, 0, day, 18).getTime()
  return {
    id,
    name,
    startedAt,
    endedAt: minutes === null ? null : startedAt + minutes * MIN,
    ...(templateId && { templateId }),
    source: templateId ? 'app' : 'strong',
    exercises: [],
    exerciseIds: [],
  }
}

describe('template stats', () => {
  it('averages the last 4 sessions, those started from it and those imported with its name', () => {
    const stats = templateStats(
      [template('p', 'Pierna'), template('t', 'Torso')],
      [
        workout('1', 'Pierna', 1, 200), // older than the last 4
        workout('2', 'pierna ', 3, 90), // imported: same name
        workout('3', 'Pierna', 5, 100, 'p'),
        workout('4', 'Torso', 6, 60, 't'),
        workout('5', 'Pierna (nueva)', 8, 80, 'p'), // renamed while doing it: still from the template
        workout('6', 'Pierna', 10, 110, 'p'),
        workout('7', 'Pierna', 12, null, 'p'), // in progress
      ],
    )
    expect(stats.get('p')).toEqual({ lastUsed: new Date(2026, 0, 10, 18).getTime(), average: { ms: 95 * MIN, sessions: 4 } })
    expect(stats.get('t')).toEqual({ lastUsed: new Date(2026, 0, 6, 18).getTime(), average: { ms: 60 * MIN, sessions: 1 } })
  })

  it('leaves out sessions started by mistake or left running, but not from the last time done', () => {
    const stats = templateStats(
      [template('p', 'Pierna')],
      [workout('1', 'Pierna', 1, 100, 'p'), workout('2', 'Pierna', 2, 300, 'p'), workout('3', 'Pierna', 3, 2, 'p')],
    )
    expect(stats.get('p')).toEqual({ lastUsed: new Date(2026, 0, 3, 18).getTime(), average: { ms: 100 * MIN, sessions: 1 } })
    expect(templateStats([template('p', 'Pierna')], [workout('1', 'Pierna', 1, 3, 'p')]).get('p')?.average).toBeNull()
  })

  it('goes by name only for workouts of no template that still exists', () => {
    const stats = templateStats(
      [template('a', 'Empuje'), template('b', 'Tirón')],
      [
        workout('1', 'Empuje', 1, 90, 'b'), // from the other template, though it has this name
        workout('2', 'Empuje', 2, 70, 'gone'), // from a template deleted since
      ],
    )
    expect(stats.get('a')?.average).toEqual({ ms: 70 * MIN, sessions: 1 })
    expect(stats.get('b')?.average).toEqual({ ms: 90 * MIN, sessions: 1 })
    expect(templateStats([template('a', 'Empuje')], []).has('a')).toBe(false)
  })
})
