import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type Workout } from '../db'

describe('notifications in the service worker', () => {
  type Listener = (event: Record<string, unknown>) => void
  interface Shown {
    title: string
    options: Record<string, unknown>
    tag: unknown
    close: () => void
  }
  let listeners: Record<string, Listener>
  /** The notifications on the lock screen, oldest first. */
  let shown: Shown[]
  let windows: { postMessage: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> }[]
  let opened: string[]

  /** The service worker's script, with or without the app's database. */
  function load(indexedDB?: IDBFactory) {
    listeners = {}
    shown = []
    windows = []
    opened = []
    const registration = {
      showNotification: async (title: string, options: Record<string, unknown>) => {
        const notification: Shown = { title, options, tag: options.tag, close: () => (shown = shown.filter((n) => n !== notification)) }
        shown.push(notification)
      },
      getNotifications: async () => [...shown],
    }
    const self = {
      addEventListener: (type: string, fn: Listener) => (listeners[type] = fn),
      registration,
      clients: { matchAll: async () => windows, openWindow: async (url: string) => void opened.push(url) },
    }
    runInNewContext(readFileSync('public/push-sw.js', 'utf8'), { self, Intl, indexedDB })
  }

  /** Dispatches an event and waits for what it asked to wait for. */
  async function dispatch(type: string, event: Record<string, unknown>) {
    let wait: Promise<unknown> = Promise.resolve()
    listeners[type]({ ...event, waitUntil: (p: Promise<unknown>) => (wait = p) })
    await wait
  }

  const rest = { data: null }
  const reminder = { data: { json: () => ({ type: 'grabar' }) } }

  // No database: the rest notification goes without the next set.
  beforeEach(() => load())

  it('shows the end of a rest for a push without a message, and the reminder for one with it', async () => {
    await dispatch('push', rest)
    await dispatch('push', reminder)
    expect(shown.map((n) => n.title)).toEqual(['Descanso terminado', 'Grabar esta semana'])
    expect(shown[0].options.body).toBe('A por la siguiente serie')
    expect(shown[1].options).toMatchObject({ tag: 'grabar', data: { hash: '#/filming' } })
  })

  it('puts each one in place of the one before, which iOS does not do by itself', async () => {
    await dispatch('push', rest)
    await dispatch('push', reminder)
    const first = shown[0]
    await dispatch('push', rest)
    await dispatch('push', rest)
    expect(shown.map((n) => n.title)).toEqual(['Grabar esta semana', 'Descanso terminado'])
    expect(shown).not.toContain(first)
  })

  it('tells the app when one arrives, so it can take it away if it is on screen', async () => {
    windows = [{ postMessage: vi.fn(), focus: vi.fn() }]
    await dispatch('push', rest)
    await dispatch('push', reminder)
    expect(windows[0].postMessage.mock.calls).toEqual([[{ type: 'notified' }], [{ type: 'notified' }]])
  })

  it('says which set is next, from the workout in progress', async () => {
    await db.exercises.clear()
    await db.workouts.clear()
    await db.exercises.bulkAdd([
      { id: 'bench', name: 'Press de banca', equipment: 'Barra', createdAt: 0 },
      { id: 'dips', name: 'Fondos', equipment: 'Peso corporal', createdAt: 0 },
    ])
    const workout: Workout = {
      id: 'w1',
      name: 'Pecho',
      startedAt: Date.now(),
      endedAt: null,
      source: 'app',
      exerciseIds: ['bench', 'dips'],
      exercises: [
        {
          exerciseId: 'bench',
          restSeconds: 120,
          sets: [
            { type: 'normal', weight: 60, reps: 8, done: true },
            { type: 'normal', weight: 62.5, reps: 8, done: false },
          ],
        },
        { exerciseId: 'dips', restSeconds: 90, sets: [{ type: 'normal', weight: null, reps: 12, done: false }] },
      ],
    }
    await db.workouts.add(workout)
    load(indexedDB)
    await dispatch('push', rest)
    // No "Siguiente:" in front: the title already says the rest is over.
    expect(shown[0].options.body).toBe('Press de banca (barra) · 62,5 kg × 8')
    workout.exercises[0].sets[1].done = true
    await db.workouts.put(workout)
    await dispatch('push', rest)
    expect(shown.map((n) => n.options.body)).toEqual(['Fondos · 12 reps'])
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

/** lib/push loaded afresh, as when the app opens, with this phone's storage. */
async function loadPush() {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  })
  vi.resetModules()
  return import('../lib/push')
}

describe('notifications in the app', () => {
  let visibility: 'visible' | 'hidden'
  let onVisibilityChange: () => void
  let onMessage: (e: { data: unknown }) => void
  let closed: number
  const place = { hash: '' }

  /** The app opens, with two notifications on the lock screen each time it looks. */
  async function open() {
    visibility = 'visible'
    closed = 0
    place.hash = ''
    const notification = () => ({ close: () => closed++ })
    vi.stubGlobal('document', {
      get visibilityState() {
        return visibility
      },
      addEventListener: (type: string, fn: () => void) => {
        if (type === 'visibilitychange') onVisibilityChange = fn
      },
    })
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration: async () => ({ getNotifications: async () => [notification(), notification()] }),
        addEventListener: (type: string, fn: (e: { data: unknown }) => void) => {
          if (type === 'message') onMessage = fn
        },
      },
    })
    vi.stubGlobal('location', place)
    const push = await loadPush()
    push.followNotifications()
    return push
  }

  const settle = () => vi.advanceTimersByTimeAsync(0)

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('takes them away when the app opens and when it comes back to the front', async () => {
    await open()
    await settle()
    expect(closed).toBe(2)
    visibility = 'hidden'
    onVisibilityChange()
    await settle()
    expect(closed).toBe(2)
    visibility = 'visible'
    onVisibilityChange()
    await settle()
    expect(closed).toBe(4)
  })

  it('takes one that arrives with the app on screen away a few seconds later', async () => {
    const { SEEN_AFTER } = await open()
    await settle()
    onMessage({ data: { type: 'notified' } })
    await vi.advanceTimersByTimeAsync(SEEN_AFTER - 100)
    expect(closed).toBe(2)
    await vi.advanceTimersByTimeAsync(100)
    expect(closed).toBe(4)
    // With the iPhone locked it stays, until the app is back on screen.
    visibility = 'hidden'
    onMessage({ data: { type: 'notified' } })
    await vi.advanceTimersByTimeAsync(SEEN_AFTER)
    expect(closed).toBe(4)
  })

  it('goes to the page a tapped reminder asks for, only inside the app', async () => {
    await open()
    onMessage({ data: { type: 'open', hash: '#/filming' } })
    expect(place.hash).toBe('#/filming')
    onMessage({ data: { type: 'open', hash: 'https://example.com/' } })
    expect(place.hash).toBe('#/filming')
  })
})

describe('the Monday reminder', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rings next on its day at its time, in the phone’s time', async () => {
    const { nextReminderAt } = await loadPush()
    const parts = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]
    const monday = { day: 1, minutes: 15 * 60 }
    expect(parts(nextReminderAt(monday, new Date(2026, 10, 12, 14)))).toEqual([2026, 11, 16, 15, 0]) // a Thursday
    expect(parts(nextReminderAt(monday, new Date(2026, 10, 15, 23)))).toEqual([2026, 11, 16, 15, 0]) // Sunday night
    expect(parts(nextReminderAt(monday, new Date(2026, 10, 16, 14, 59)))).toEqual([2026, 11, 16, 15, 0])
    expect(parts(nextReminderAt(monday, new Date(2026, 10, 16, 15)))).toEqual([2026, 11, 23, 15, 0]) // it just rang
    // Across the change to summer time, and across the new year on a Sunday.
    expect(parts(nextReminderAt({ day: 1, minutes: 9 * 60 + 30 }, new Date(2027, 2, 22, 16)))).toEqual([2027, 3, 29, 9, 30])
    expect(parts(nextReminderAt({ day: 0, minutes: 20 * 60 }, new Date(2026, 11, 31, 12)))).toEqual([2027, 1, 3, 20, 0])
  })
})
