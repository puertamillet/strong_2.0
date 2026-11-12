import { App } from '@capacitor/app'
import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications'
import { liveQuery, type Subscription } from 'dexie'
import { db } from '../db'
import { exerciseLabel } from './exercises'
import { fmtNumber } from './format'
import type { ReminderTime } from './push'

/**
 * Notifications in the iPhone app (see lib/native): local notifications, which the app schedules on
 * the iPhone itself, with no server and nothing in between (the web app needs the push server, see
 * lib/push, which uses this module in the iPhone app). Unlike the web app's, they show only their
 * title and text (no «from Strong 2.0»), the rest ones ring with the app's ping, and the app can
 * take them all away.
 */

/** Whether iOS lets the app notify: 'prompt' until it has been asked. */
export type Permission = 'granted' | 'denied' | 'prompt'

/** One of each at a time: a new rest's notification takes the place of the one before. */
const REST = 1
const REMINDER = 2
const REMINDER_TRY = 3

/** The ping, which the app copies to where iOS looks for notification sounds (native/strong-native). */
const PING = 'ping.wav'
/** Not a sound file, so iOS rings with its usual notification sound. */
const USUAL_SOUND = 'default'

function permissionOf(display: string): Permission {
  return display === 'granted' || display === 'denied' ? display : 'prompt'
}

export async function checkPermission(): Promise<Permission> {
  return permissionOf((await LocalNotifications.checkPermissions()).display)
}

/** Asks iOS for permission to notify; it only asks the first time, then it says what was answered. */
export async function askPermission(): Promise<Permission> {
  return permissionOf((await LocalNotifications.requestPermissions()).display)
}

/**
 * "Press de banca (barra) · 60 kg × 8": the first set not ticked yet of the workout in progress, as
 * the web app's notification says it (public/push-sw.js). Null if there is none.
 */
export async function nextSetText(): Promise<string | null> {
  // The workout in progress is always the last one started.
  const workout = await db.workouts.orderBy('startedAt').last()
  if (!workout || workout.endedAt !== null) return null
  for (const we of workout.exercises) {
    const set = we.sets.find((s) => !s.done)
    if (!set) continue
    const exercise = await db.exercises.get(we.exerciseId)
    const name = exercise ? exerciseLabel(exercise) : 'Siguiente ejercicio'
    if (set.reps === null && set.weight === null) return name
    return `${name} · ${set.weight ? `${fmtNumber(set.weight)} kg × ${set.reps ?? '—'}` : `${set.reps} reps`}`
  }
  return null
}

interface Rest {
  endsAt: number
  /** The next set (nextSetText). */
  next: string | null
}

/** The rest whose end is to be notified. */
let rest: Rest | null = null
let watching: Subscription | null = null
let applying: Promise<void> = Promise.resolve()

function restNotification({ endsAt, next }: Rest): LocalNotificationSchema {
  return {
    id: REST,
    title: 'Descanso terminado',
    body: next ?? 'A por la siguiente serie',
    schedule: { at: new Date(endsAt) },
    sound: PING,
    // With the app on screen there is no notification: the app pings by itself (useRestAlarm).
    foreground: false,
  }
}

/**
 * Brings the scheduled notification in line with `rest`. Changes go one at a time and in order (the
 * plugin takes a moment to schedule one, and a cancel sent meanwhile would go first), and each one
 * applies the latest rest.
 */
function apply(): Promise<void> {
  applying = applying.then(async () => {
    const wanted = rest
    try {
      if (wanted && wanted.endsAt > Date.now()) await LocalNotifications.schedule({ notifications: [restNotification(wanted)] })
      else await LocalNotifications.cancel({ notifications: [{ id: REST }] })
    } catch {
      // Nothing else to try: the app pings if it is on screen.
    }
  })
  return applying
}

/**
 * Notifies the end of the rest at `endsAt`, or cancels the notification (null: there is no rest
 * now). The notification says the next set, and follows the workout while the rest runs: ticking
 * the set that started it, or changing the next one's weight.
 */
export function scheduleRest(endsAt: number | null): Promise<void> {
  watching?.unsubscribe()
  watching = null
  rest = endsAt !== null && endsAt > Date.now() ? { endsAt, next: null } : null
  if (rest) {
    watching = liveQuery(nextSetText).subscribe({
      next: (next) => {
        if (rest?.endsAt !== endsAt || next === rest.next) return
        // Once it is over there is nothing to change (and a notification in the past would ring at once).
        if (endsAt <= Date.now()) return
        rest = { endsAt, next }
        void apply()
      },
      error: () => {},
    })
  }
  return apply()
}

/** The weekly reminder to choose what to film, as in the web app (public/push-sw.js). */
function reminderNotification(id: number): LocalNotificationSchema {
  return {
    id,
    title: 'Grabar esta semana',
    body: 'Elige los ejercicios que te toca grabar: en el entreno verás marcada la serie.',
    sound: USUAL_SOUND,
    // A tap opens that page (followLocalNotifications).
    extra: { hash: '#/filming' },
  }
}

/**
 * Sets the weekly reminder (null: none). It rings on its day at its time on the iPhone's clock,
 * also after changing time zone.
 */
export async function scheduleReminder(time: ReminderTime | null): Promise<void> {
  await LocalNotifications.cancel({ notifications: [{ id: REMINDER }] })
  if (!time) return
  await LocalNotifications.schedule({
    notifications: [
      {
        ...reminderNotification(REMINDER),
        // Capacitor counts the days of the week from Sunday = 1.
        schedule: { on: { weekday: time.day + 1, hour: Math.floor(time.minutes / 60), minute: time.minutes % 60 } },
      },
    ],
  })
}

/** The reminder once, 10 seconds from now, to try it. */
export async function tryReminder(): Promise<void> {
  await LocalNotifications.schedule({
    notifications: [{ ...reminderNotification(REMINDER_TRY), schedule: { at: new Date(Date.now() + 10_000) } }],
  })
}

/**
 * Notifications don't pile up: they go away once you are in the app, when it opens or comes back to
 * the front, and `seenAfter` ms after one arrives with the app on screen. A tap on the reminder
 * opens its page. `onResume` runs when the app comes back to the front.
 */
export function followLocalNotifications(onResume: () => void, seenAfter: number): void {
  const clear = () => void LocalNotifications.removeAllDeliveredNotifications().catch(() => {})
  clear()
  void App.addListener('resume', () => {
    clear()
    onResume()
  })
  void LocalNotifications.addListener('localNotificationReceived', () => setTimeout(clear, seenAfter))
  void LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
    const hash = (notification.extra as { hash?: unknown } | null | undefined)?.hash
    if (typeof hash === 'string' && hash.startsWith('#/')) location.hash = hash
  })
}
