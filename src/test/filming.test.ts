import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TemplateExercise, WorkoutSet } from '../db'
import { filmSetIndex, filmSetIndexes, fromTemplateExercise, nextSet, setKeys, templateExercise } from '../lib/workouts'

const set = (type: WorkoutSet['type'], film?: boolean): WorkoutSet => ({ type, weight: null, reps: null, done: false, ...(film && { film }) })

describe('the week to film', () => {
  /** The module with a fresh storage, as when the app opens. */
  async function load(storage: Map<string, string>) {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    })
    vi.resetModules()
    return import('../lib/filming')
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('goes from Monday to Sunday', async () => {
    const { weekOf, weekDays } = await load(new Map())
    expect(weekOf(new Date(2026, 10, 16, 15))).toBe('2026-11-16') // Monday
    expect(weekOf(new Date(2026, 10, 22, 23, 59))).toBe('2026-11-16') // Sunday night
    expect(weekOf(new Date(2026, 10, 12))).toBe('2026-11-09') // Thursday
    expect(weekOf(new Date(2027, 0, 2))).toBe('2026-12-28') // across the new year
    const [monday, sunday] = weekDays(new Date(2026, 11, 2))
    expect([monday.getDate(), monday.getMonth(), sunday.getDate(), sunday.getMonth()]).toEqual([30, 10, 6, 11])
  })

  it('keeps the exercises chosen for the week, and starts the next one with none', async () => {
    const storage = new Map<string, string>()
    let filming = await load(storage)
    const thursday = new Date(2026, 10, 12, 18)
    expect(filming.filmingThisWeek(thursday)).toEqual([])
    filming.setFilming('bench', true, thursday)
    filming.setFilming('squat', true, thursday)
    filming.setFilming('bench', false, thursday)
    filming.setFilming('row', true, thursday)
    expect(filming.filmingThisWeek(thursday)).toEqual([{ exerciseId: 'squat' }, { exerciseId: 'row' }])
    // Opening the app again later that week.
    filming = await load(storage)
    expect(filming.filmingThisWeek(new Date(2026, 10, 15, 22))).toEqual([{ exerciseId: 'squat' }, { exerciseId: 'row' }])
    expect(filming.filmingThisWeek(new Date(2026, 10, 16, 9))).toEqual([])
    filming.setFilming('curl', true, new Date(2026, 10, 16, 15))
    expect(filming.filmingThisWeek(new Date(2026, 10, 16, 15))).toEqual([{ exerciseId: 'curl' }])
  })

  it('keeps which sets to film, and with none the exercise is no longer chosen', async () => {
    const storage = new Map<string, string>()
    let filming = await load(storage)
    const monday = new Date(2026, 10, 16, 15)
    filming.setFilming('bench', true, monday)
    filming.setFilmSets('bench', ['1', '3'], monday)
    filming.setFilming('bench', true, monday) // already chosen: its sets stay
    filming.setFilmSets('squat', ['C1'], monday) // choosing a set chooses the exercise
    expect(filming.filmingThisWeek(monday)).toEqual([
      { exerciseId: 'bench', sets: ['1', '3'] },
      { exerciseId: 'squat', sets: ['C1'] },
    ])
    filming = await load(storage)
    filming.setFilmSets('bench', [], monday)
    expect(filming.filmingThisWeek(monday)).toEqual([{ exerciseId: 'squat', sets: ['C1'] }])
  })

  it('reads what was kept before the sets could be chosen: those exercises, to film their default set', async () => {
    const storage = new Map([['strong2.filming', JSON.stringify({ week: '2026-11-16', exerciseIds: ['bench', 'squat'] })]])
    const filming = await load(storage)
    expect(filming.filmingThisWeek(new Date(2026, 10, 17))).toEqual([{ exerciseId: 'bench' }, { exerciseId: 'squat' }])
  })
})

describe('the set to film', () => {
  it('is the one marked in the template, else the first that is not a warm-up', () => {
    expect(filmSetIndex([set('warmup'), set('warmup'), set('top'), set('backoff')])).toBe(2)
    expect(filmSetIndex([set('warmup'), set('normal'), set('normal', true)])).toBe(2)
    expect(filmSetIndex([set('warmup'), set('warmup')])).toBe(0)
    expect(filmSetIndex([])).toBe(-1)
  })

  it('is the same one in every template, though their warm-ups differ: counted after the warm-ups', () => {
    expect(setKeys([set('warmup'), set('warmup'), set('top'), set('backoff'), set('backoff')])).toEqual(['C1', 'C2', '1', '2', '3'])
    expect(setKeys([set('normal'), set('drop'), set('failure')])).toEqual(['1', '2', '3'])
    // The 1st and 3rd sets after the warm-ups, with two warm-ups and with none.
    expect(filmSetIndexes([set('warmup'), set('warmup'), set('top'), set('backoff'), set('backoff')], ['1', '3'])).toEqual([2, 4])
    expect(filmSetIndexes([set('top'), set('backoff'), set('backoff')], ['1', '3'])).toEqual([0, 2])
    expect(filmSetIndexes([set('warmup'), set('warmup'), set('normal')], ['C2'])).toEqual([1])
    expect(filmSetIndexes([set('normal')], ['2'])).toEqual([])
  })

  it('while the sets are not chosen, is the default one: marked in the template, else the first after the warm-ups', () => {
    expect(filmSetIndexes([set('warmup'), set('top'), set('backoff')])).toEqual([1])
    expect(filmSetIndexes([set('warmup'), set('normal'), set('normal', true)])).toEqual([2])
    expect(filmSetIndexes([])).toEqual([])
  })

  it('goes from the template to the workout and back, and a set added is not filmed', () => {
    const te: TemplateExercise = {
      exerciseId: 'bench',
      restSeconds: 120,
      sets: [{ type: 'warmup', weight: 40, reps: 10 }, { type: 'top', weight: 100, reps: 5, film: true }, { type: 'backoff', weight: 90, reps: 8 }],
    }
    const we = fromTemplateExercise(te)
    expect(we.sets.map((s) => s.film ?? false)).toEqual([false, true, false])
    expect(templateExercise(we).sets.map((s) => s.film ?? false)).toEqual([false, true, false])
    expect(nextSet({ ...we, sets: we.sets.slice(0, 2) }).film).toBeUndefined()
  })
})
