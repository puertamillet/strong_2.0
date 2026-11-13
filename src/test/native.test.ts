import 'fake-indexeddb/auto'
import type { LocalNotificationSchema } from '@capacitor/local-notifications'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Workout } from '../db'

/** iOS's notifications as the iPhone app sees them through the Capacitor plugin. */
function fakeNotifications(start: { permission?: string; answer?: string } = {}) {
  let permission = start.permission ?? 'prompt'
  const pending = new Map<number, LocalNotificationSchema>()
  const listeners: Record<string, (event: unknown) => void> = {}
  const calls: string[] = []
  let cleared = 0
  const plugin = {
    checkPermissions: vi.fn(async () => ({ display: permission })),
    // iOS only asks the first time.
    requestPermissions: vi.fn(async () => {
      if (permission === 'prompt') permission = start.answer ?? 'granted'
      return { display: permission }
    }),
    schedule: vi.fn(async ({ notifications }: { notifications: LocalNotificationSchema[] }) => {
      for (const n of notifications) pending.set(n.id, n)
      calls.push(`schedule ${notifications.map((n) => n.id).join()}`)
      return { notifications: notifications.map((n) => ({ id: n.id })) }
    }),
    cancel: vi.fn(async ({ notifications }: { notifications: { id: number }[] }) => {
      for (const n of notifications) pending.delete(n.id)
      calls.push(`cancel ${notifications.map((n) => n.id).join()}`)
    }),
    removeAllDeliveredNotifications: vi.fn(async () => void cleared++),
    addListener: vi.fn(async (name: string, fn: (event: unknown) => void) => {
      listeners[name] = fn
      return { remove: async () => {} }
    }),
  }
  return { plugin, pending, listeners, calls, cleared: () => cleared }
}

const strongNative = {
  ping: vi.fn(async () => {}),
  ringAt: vi.fn<(options: { endsAt: number | null }) => Promise<void>>(async () => {}),
  restActivity: vi.fn<(options: unknown) => Promise<void>>(async () => {}),
  keepAwake: vi.fn<(options: { on: boolean }) => Promise<void>>(async () => {}),
}
const haptics = {
  impact: vi.fn<(options: unknown) => Promise<void>>(async () => {}),
  vibrate: vi.fn<(options: unknown) => Promise<void>>(async () => {}),
}
const appListeners: Record<string, () => void> = {}

/** The iPhone app's modules, loaded afresh as when it opens, with this phone's storage and notifications. */
async function loadApp(notifications = fakeNotifications(), saved: Record<string, string> = {}) {
  const storage = new Map(Object.entries(saved))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  })
  vi.resetModules()
  vi.doMock('../lib/native', () => ({ isNativeApp: true, StrongNative: strongNative, checkNativePlugins: () => {} }))
  vi.doMock('@capacitor/local-notifications', () => ({ LocalNotifications: notifications.plugin }))
  vi.doMock('@capacitor/app', () => ({
    App: { addListener: async (name: string, fn: () => void) => void (appListeners[name] = fn) },
  }))
  vi.doMock('@capacitor/haptics', () => ({ Haptics: haptics, ImpactStyle: { Light: 'LIGHT' } }))
  const { db } = await import('../db')
  const local = await import('../lib/localNotifications')
  const push = await import('../lib/push')
  return { db, local, push, notifications, storage }
}

/** A workout in progress: the first set of the bench press done, its second one next, then dips. */
async function startWorkout(db: Awaited<ReturnType<typeof loadApp>>['db']): Promise<Workout> {
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
  return workout
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('rest notifications in the iPhone app', () => {
  it('rings with the ping when the rest is over, saying the next set, and not with the app on screen', async () => {
    const { db, local, notifications } = await loadApp()
    await startWorkout(db)
    const endsAt = Date.now() + 90_000
    await local.scheduleRest(endsAt)
    expect(notifications.pending.get(1)).toMatchObject({
      title: 'Descanso terminado',
      schedule: { at: new Date(endsAt) },
      sound: 'ping.wav',
      foreground: false,
    })
    // The same text as the web app's notification (public/push-sw.js).
    await vi.waitFor(() => expect(notifications.pending.get(1)?.body).toBe('Press de banca (barra) · 62,5 kg × 8'))
  })

  it('follows the workout while the rest runs', async () => {
    const { db, local, notifications } = await loadApp()
    const workout = await startWorkout(db)
    await local.scheduleRest(Date.now() + 90_000)
    await vi.waitFor(() => expect(notifications.pending.get(1)?.body).toBe('Press de banca (barra) · 62,5 kg × 8'))
    // The set that started the rest gets ticked a moment later.
    workout.exercises[0].sets[1].done = true
    await db.workouts.put(workout)
    await vi.waitFor(() => expect(notifications.pending.get(1)?.body).toBe('Fondos · 12 reps'))
    workout.endedAt = Date.now()
    await db.workouts.put(workout)
    await vi.waitFor(() => expect(notifications.pending.get(1)?.body).toBe('A por la siguiente serie'))
  })

  it('is cancelled when the rest is skipped, also while it is still being scheduled', async () => {
    const { db, local, notifications } = await loadApp()
    await db.workouts.clear()
    let scheduled = () => {}
    const schedule = notifications.plugin.schedule.getMockImplementation()!
    notifications.plugin.schedule.mockImplementationOnce(
      (options) => new Promise((resolve) => (scheduled = () => resolve(schedule(options)))),
    )
    const first = local.scheduleRest(Date.now() + 90_000)
    // iOS takes a moment to schedule it…
    await vi.waitFor(() => expect(notifications.plugin.schedule).toHaveBeenCalledTimes(1))
    const skipped = local.scheduleRest(null)
    await new Promise((r) => setTimeout(r, 20))
    // …and the cancel waits for it, or it would go first and leave the notification behind.
    expect(notifications.plugin.cancel).not.toHaveBeenCalled()
    scheduled()
    await Promise.all([first, skipped])
    expect(notifications.calls).toEqual(['schedule 1', 'cancel 1'])
    expect(notifications.pending.size).toBe(0)
    // Skipped before it was even sent: it isn't scheduled at all.
    await Promise.all([local.scheduleRest(Date.now() + 90_000), local.scheduleRest(null)])
    expect(notifications.plugin.schedule).toHaveBeenCalledTimes(1)
    expect(notifications.pending.size).toBe(0)
  })

  it('stays as it is once the rest is over', async () => {
    const { db, local, notifications } = await loadApp()
    const workout = await startWorkout(db)
    await local.scheduleRest(Date.now() + 200)
    await vi.waitFor(() => expect(notifications.pending.get(1)?.body).toBe('Press de banca (barra) · 62,5 kg × 8'))
    await new Promise((r) => setTimeout(r, 250))
    const calls = notifications.calls.length
    workout.exercises[0].sets[1].done = true
    await db.workouts.put(workout)
    await new Promise((r) => setTimeout(r, 100))
    // Scheduling it now would ring at once.
    expect(notifications.calls).toHaveLength(calls)
  })
})

describe('the Monday reminder in the iPhone app', () => {
  it('rings every week on its day at its time, with the usual sound, and opens its page', async () => {
    const { local, notifications } = await loadApp()
    await local.scheduleReminder({ day: 1, minutes: 15 * 60 + 30 })
    expect(notifications.pending.get(2)).toMatchObject({
      title: 'Grabar esta semana',
      body: 'Elige los ejercicios que te toca grabar: en el entreno verás marcada la serie.',
      // Capacitor's days go from Sunday = 1.
      schedule: { on: { weekday: 2, hour: 15, minute: 30 } },
      sound: 'default',
      extra: { hash: '#/filming' },
    })
    await local.scheduleReminder(null)
    expect(notifications.pending.has(2)).toBe(false)
  })

  it('can be tried: once, 10 seconds later', async () => {
    const { local, notifications } = await loadApp()
    const before = Date.now()
    await local.tryReminder()
    const at = notifications.pending.get(3)?.schedule?.at
    expect(at).toBeInstanceOf(Date)
    expect(Number(at) - before).toBeGreaterThanOrEqual(10_000)
    expect(Number(at) - before).toBeLessThan(11_000)
    expect(notifications.pending.get(3)).toMatchObject({ title: 'Grabar esta semana', extra: { hash: '#/filming' } })
  })
})

describe('notifications going away in the iPhone app', () => {
  it('when it opens, when it comes back, and a few seconds after one arrives on screen; a tap opens its page', async () => {
    vi.useFakeTimers()
    const place = { hash: '' }
    vi.stubGlobal('location', place)
    const { local, notifications } = await loadApp()
    const resumed = vi.fn()
    local.followLocalNotifications(resumed, 4000)
    await vi.advanceTimersByTimeAsync(0)
    expect(notifications.cleared()).toBe(1)
    appListeners.resume()
    expect(notifications.cleared()).toBe(2)
    expect(resumed).toHaveBeenCalledTimes(1)
    notifications.listeners.localNotificationReceived({})
    await vi.advanceTimersByTimeAsync(3900)
    expect(notifications.cleared()).toBe(2)
    await vi.advanceTimersByTimeAsync(100)
    expect(notifications.cleared()).toBe(3)
    notifications.listeners.localNotificationActionPerformed({ actionId: 'tap', notification: { extra: { hash: '#/filming' } } })
    expect(place.hash).toBe('#/filming')
    notifications.listeners.localNotificationActionPerformed({ actionId: 'tap', notification: { extra: { hash: 'https://example.com' } } })
    notifications.listeners.localNotificationActionPerformed({ actionId: 'tap', notification: {} })
    expect(place.hash).toBe('#/filming')
  })
})

describe('notification settings in the iPhone app', () => {
  it('asks to notify the first time it opens: rest alerts are on unless turned off', async () => {
    const { push, notifications } = await loadApp()
    expect(push.pushStatus()).toBe('off')
    await push.checkPushSubscription()
    expect(notifications.plugin.requestPermissions).toHaveBeenCalledTimes(1)
    expect(push.pushStatus()).toBe('on')
    expect(push.reminderStatus()).toBe('off')
    const endsAt = Date.now() + 60_000
    push.scheduleRestPush(endsAt)
    await vi.waitFor(() => expect(notifications.pending.get(1)?.schedule?.at).toEqual(new Date(endsAt)))
    // The app also rings by itself at the end, with the iPhone locked too.
    expect(strongNative.ringAt).toHaveBeenLastCalledWith({ endsAt })
    push.scheduleRestPush(null)
    await vi.waitFor(() => expect(notifications.pending.has(1)).toBe(false))
    expect(strongNative.ringAt).toHaveBeenLastCalledWith({ endsAt: null })
  })

  it('does not ask if rest alerts were turned off, and says so when iOS does not let it notify', async () => {
    const off = await loadApp(fakeNotifications(), { 'strong2.restPush': 'off' })
    await off.push.checkPushSubscription()
    expect(off.notifications.plugin.requestPermissions).not.toHaveBeenCalled()
    off.push.scheduleRestPush(Date.now() + 60_000)
    await new Promise((r) => setTimeout(r, 20))
    expect(off.notifications.pending.size).toBe(0)
    expect(strongNative.ringAt).toHaveBeenLastCalledWith({ endsAt: null })
    const denied = await loadApp(fakeNotifications({ answer: 'denied' }))
    await denied.push.checkPushSubscription()
    expect(denied.push.pushStatus()).toBe('denied')
    expect(denied.push.reminderStatus()).toBe('denied')
    const endsAt = Date.now() + 60_000
    denied.push.scheduleRestPush(endsAt)
    await new Promise((r) => setTimeout(r, 20))
    expect(denied.notifications.pending.size).toBe(0)
    // Without notifications, the app still rings by itself.
    expect(strongNative.ringAt).toHaveBeenLastCalledWith({ endsAt })
  })

  it('turns rest alerts off and on again', async () => {
    const { push, notifications } = await loadApp(fakeNotifications({ permission: 'granted' }))
    await push.checkPushSubscription()
    push.scheduleRestPush(Date.now() + 60_000)
    await vi.waitFor(() => expect(notifications.pending.has(1)).toBe(true))
    await push.disablePush()
    expect(notifications.pending.has(1)).toBe(false)
    expect(strongNative.ringAt).toHaveBeenLastCalledWith({ endsAt: null })
    expect(push.pushStatus()).toBe('off')
    expect(await push.enablePush()).toBe('on')
  })

  it('rings the end of the rest by itself again when iOS closed the app during the rest and it opens', async () => {
    const endsAt = Date.now() + 60_000
    const { db } = await loadApp(fakeNotifications({ permission: 'granted' }), {
      'strong2.restTimer': JSON.stringify({ endsAt, total: 90 }),
    })
    await db.workouts.clear()
    await import('../lib/restTimer')
    expect(strongNative.ringAt).toHaveBeenLastCalledWith({ endsAt })
    // And it is on the lock screen again.
    await vi.waitFor(() =>
      expect(strongNative.restActivity).toHaveBeenLastCalledWith({ startedAt: endsAt - 90_000, endsAt, exercise: null, detail: null }),
    )
    // It stops following the workout, which the next tests change.
    const { showRest } = await import('../lib/liveActivity')
    showRest(null)
  })

  it('turns the Monday reminder on, moves it, tries it and turns it off; it is set again when the app opens', async () => {
    const { push, notifications, storage } = await loadApp(fakeNotifications({ permission: 'granted' }))
    await push.checkPushSubscription()
    expect(await push.enableReminder({ day: 1, minutes: 15 * 60 })).toBe('on')
    expect(notifications.pending.get(2)?.schedule?.on).toEqual({ weekday: 2, hour: 15, minute: 0 })
    await push.setReminderTime({ day: 1, minutes: 9 * 60 + 30 })
    expect(notifications.pending.get(2)?.schedule?.on).toEqual({ weekday: 2, hour: 9, minute: 30 })
    await push.testReminder()
    expect(notifications.pending.has(3)).toBe(true)

    const again = await loadApp(fakeNotifications({ permission: 'granted' }), Object.fromEntries(storage))
    await again.push.checkPushSubscription()
    expect(again.push.reminderStatus()).toBe('on')
    expect(again.notifications.pending.get(2)?.schedule?.on).toEqual({ weekday: 2, hour: 9, minute: 30 })
    await again.push.disableReminder()
    expect(again.notifications.pending.has(2)).toBe(false)
    expect(again.push.reminderStatus()).toBe('off')
  })
})

describe('the rest on the lock screen and in the Dynamic Island (iPhone app)', () => {
  it('shows the countdown and the next set, follows the workout, and goes away when the rest is stopped', async () => {
    const { db } = await loadApp()
    const workout = await startWorkout(db)
    const { showRest } = await import('../lib/liveActivity')
    const endsAt = Date.now() + 120_000
    showRest({ endsAt, total: 120 })
    const shown = (exercise: string | null, detail: string | null) =>
      expect(strongNative.restActivity).toHaveBeenLastCalledWith({ startedAt: endsAt - 120_000, endsAt, exercise, detail })
    await vi.waitFor(() => shown('Press de banca (barra)', '62,5 kg × 8 · serie 2 de 2'))
    // The set that started the rest gets ticked a moment later.
    workout.exercises[0].sets[1].done = true
    await db.workouts.put(workout)
    await vi.waitFor(() => shown('Fondos', '12 reps · serie 1 de 1'))
    // Changes elsewhere in the workout don't change it.
    const calls = strongNative.restActivity.mock.calls.length
    workout.name = 'Pecho y tríceps'
    await db.workouts.put(workout)
    await new Promise((r) => setTimeout(r, 50))
    expect(strongNative.restActivity).toHaveBeenCalledTimes(calls)
    showRest(null)
    expect(strongNative.restActivity).toHaveBeenLastCalledWith({ endsAt: null })
    // Once stopped, the workout no longer changes it.
    workout.exercises[1].sets[0].done = true
    await db.workouts.put(workout)
    await new Promise((r) => setTimeout(r, 50))
    expect(strongNative.restActivity).toHaveBeenLastCalledWith({ endsAt: null })
  })

  it('starts, changes and goes away with the rest timer, also when the workout ends after the rest', async () => {
    const { db, storage } = await loadApp()
    await startWorkout(db)
    const { restTimer } = await import('../lib/restTimer')
    // Nothing on the lock screen when the app opens without a rest.
    expect(strongNative.restActivity).toHaveBeenLastCalledWith({ endsAt: null })
    restTimer.start(90)
    const { endsAt } = JSON.parse(storage.get('strong2.restTimer') ?? '{}') as { endsAt: number }
    await vi.waitFor(() =>
      expect(strongNative.restActivity).toHaveBeenLastCalledWith(expect.objectContaining({ startedAt: endsAt - 90_000, endsAt })),
    )
    restTimer.adjust(10)
    await vi.waitFor(() =>
      expect(strongNative.restActivity).toHaveBeenLastCalledWith(
        expect.objectContaining({ startedAt: endsAt - 90_000, endsAt: endsAt + 10_000 }),
      ),
    )
    restTimer.expire()
    restTimer.stop()
    expect(strongNative.restActivity).toHaveBeenLastCalledWith({ endsAt: null })
  })
})

describe('the ping, vibration and saved files in the iPhone app', () => {
  it('plays the ping natively and vibrates twice, with no audio in the page', async () => {
    vi.useFakeTimers()
    const AudioContext = vi.fn()
    vi.stubGlobal('window', { AudioContext })
    await loadApp()
    const { primeAudio, signalRestOver } = await import('../lib/sound')
    expect(primeAudio()).toBeNull()
    signalRestOver()
    expect(strongNative.ping).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(haptics.vibrate.mock.calls).toEqual([[{ duration: 200 }], [{ duration: 200 }]])
    expect(AudioContext).not.toHaveBeenCalled()
  })

  it('gives a light tap for a tick', async () => {
    await loadApp()
    const { haptic } = await import('../lib/haptics')
    haptic()
    haptic(15)
    expect(haptics.impact.mock.calls).toEqual([[{ style: 'LIGHT' }], [{ style: 'LIGHT' }]])
    expect(haptics.vibrate).not.toHaveBeenCalled()
  })

  it('saves files through the share sheet', async () => {
    const share = vi.fn<(options: unknown) => Promise<object>>(async () => ({}))
    const writeFile = vi.fn<(options: unknown) => Promise<{ uri: string }>>(async () => ({ uri: 'file:///cache/copia.json' }))
    vi.doMock('@capacitor/share', () => ({ Share: { share } }))
    vi.doMock('@capacitor/filesystem', () => ({ Filesystem: { writeFile }, Directory: { Cache: 'CACHE' }, Encoding: { UTF8: 'utf8' } }))
    await loadApp()
    const { saveFile } = await import('../lib/backup')
    expect(await saveFile('copia.json', '{"app":"strong2"}', 'application/json')).toBe(true)
    expect(writeFile).toHaveBeenCalledWith({ path: 'copia.json', data: '{"app":"strong2"}', directory: 'CACHE', encoding: 'utf8' })
    expect(share).toHaveBeenCalledWith({ files: ['file:///cache/copia.json'] })
    // Closed without saving: the backup isn't marked as done.
    share.mockRejectedValueOnce(new Error('Share canceled'))
    expect(await saveFile('copia.json', '{}', 'application/json')).toBe(false)
    share.mockRejectedValueOnce(new Error('Error sharing item'))
    await expect(saveFile('copia.json', '{}', 'application/json')).rejects.toThrow('Error sharing item')
  })
})
