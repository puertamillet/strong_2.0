import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TemplateExercise, WorkoutSet } from '../db'
import { filmSetIndex, fromTemplateExercise, nextSet, templateExercise } from '../lib/workouts'

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
    expect(filming.filmingThisWeek(thursday)).toEqual(['squat', 'row'])
    // Opening the app again later that week.
    filming = await load(storage)
    expect(filming.filmingThisWeek(new Date(2026, 10, 15, 22))).toEqual(['squat', 'row'])
    expect(filming.filmingThisWeek(new Date(2026, 10, 16, 9))).toEqual([])
    filming.setFilming('curl', true, new Date(2026, 10, 16, 15))
    expect(filming.filmingThisWeek(new Date(2026, 10, 16, 15))).toEqual(['curl'])
  })
})

describe('the set to film', () => {
  it('is the one marked in the template, else the first that is not a warm-up', () => {
    expect(filmSetIndex([set('warmup'), set('warmup'), set('top'), set('backoff')])).toBe(2)
    expect(filmSetIndex([set('warmup'), set('normal'), set('normal', true)])).toBe(2)
    expect(filmSetIndex([set('warmup'), set('warmup')])).toBe(0)
    expect(filmSetIndex([])).toBe(-1)
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

describe('notifications in the service worker', () => {
  type Listener = (event: Record<string, unknown>) => void
  let listeners: Record<string, Listener>
  let shown: { title: string; options: Record<string, unknown> }[]
  let windows: { postMessage: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> }[]
  let opened: string[]

  beforeEach(() => {
    listeners = {}
    shown = []
    windows = []
    opened = []
    const self = {
      addEventListener: (type: string, fn: Listener) => (listeners[type] = fn),
      registration: { showNotification: async (title: string, options: Record<string, unknown>) => void shown.push({ title, options }) },
      clients: { matchAll: async () => windows, openWindow: async (url: string) => void opened.push(url) },
    }
    // No database here: the rest notification goes without the next set.
    runInNewContext(readFileSync('public/push-sw.js', 'utf8'), { self, Intl, indexedDB: undefined })
  })

  /** Dispatches an event and waits for what it asked to wait for. */
  async function dispatch(type: string, event: Record<string, unknown>) {
    let wait: Promise<unknown> = Promise.resolve()
    listeners[type]({ ...event, waitUntil: (p: Promise<unknown>) => (wait = p) })
    await wait
  }

  it('shows the end of a rest for a push without a message, and the reminder for one with it', async () => {
    await dispatch('push', { data: null })
    await dispatch('push', { data: { json: () => ({ type: 'grabar' }) } })
    expect(shown.map((n) => n.title)).toEqual(['Descanso terminado', 'Grabar esta semana'])
    expect(shown[1].options).toMatchObject({ tag: 'grabar', data: { hash: '#/filming' } })
  })

  it('opens the page when the reminder is tapped, in the app if it is open', async () => {
    const close = vi.fn()
    await dispatch('notificationclick', { notification: { close, data: { hash: '#/filming' } } })
    expect(opened).toEqual(['./#/filming'])
    windows = [{ postMessage: vi.fn(), focus: vi.fn(async () => undefined) }]
    await dispatch('notificationclick', { notification: { close, data: { hash: '#/filming' } } })
    expect(windows[0].postMessage).toHaveBeenCalledWith({ type: 'open', hash: '#/filming' })
    expect(windows[0].focus).toHaveBeenCalled()
    // The end of a rest only brings the app to the front.
    await dispatch('notificationclick', { notification: { close, data: null } })
    expect(windows[0].postMessage).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(3)
  })
})
