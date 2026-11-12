import { useSyncExternalStore } from 'react'

/**
 * Notifications with the iPhone locked or in another app (Web Push): the end of each rest, and a
 * weekly reminder to choose which exercises to film that week.
 *
 * A web app in the background is frozen and can't ring, so when a rest starts the app tells a
 * small server (push-server/, a free Cloudflare Worker) when it ends, and at that moment the
 * server asks Apple to wake the app, which shows a notification (public/push-sw.js). The server
 * only gets this phone's push address and the time; the text is made here, on the phone. For the
 * weekly reminder it also gets the day, the time and the time zone, and the subscription's keys
 * to encrypt the reminder (so the app can tell it from a rest).
 *
 * Both use the same push subscription, which exists while either is on. On iPhone it needs iOS
 * 16.4+, the app added to the home screen and permission to notify.
 */

/** The push server, set when the app is built (empty: no server, no notifications). */
const SERVER = (import.meta.env.VITE_PUSH_URL ?? '').replace(/\/+$/, '')

/**
 * - on / off: available, and turned on or not
 * - no-server: this build has no push server
 * - not-installed: only the app on the home screen can notify (iPhone), or the browser can't
 * - denied: notifications were refused for the app (iPhone Settings → Notifications)
 */
export type PushStatus = 'on' | 'off' | 'no-server' | 'not-installed' | 'denied'

/** When the weekly reminder rings: a day of the week (0 = Sunday) and minutes after midnight. */
export interface ReminderTime {
  day: number
  minutes: number
}

export interface Reminder extends ReminderTime {
  on: boolean
  /** When it rings next, as the server said (ms since 1970). */
  next?: number
}

/** Monday at 15:00. */
export const DEFAULT_REMINDER: Reminder = { on: false, day: 1, minutes: 15 * 60 }

/** The push subscription's address, while rest alerts or the reminder are on. */
const KEY = 'strong2.pushEndpoint'
/** 'off' when rest alerts are off but the subscription is kept for the reminder. */
const REST_KEY = 'strong2.restPush'
const REMINDER_KEY = 'strong2.reminder'

const listeners = new Set<() => void>()
let endpoint = readItem(KEY)
let restOff = readItem(REST_KEY) === 'off'
let reminder = readReminder()

function readItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeItem(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Storage unavailable; the setting lasts until the app closes.
  }
}

function readReminder(): Reminder {
  try {
    const saved = JSON.parse(readItem(REMINDER_KEY) ?? 'null') as Partial<Reminder> | null
    if (!saved || typeof saved.day !== 'number' || typeof saved.minutes !== 'number') return DEFAULT_REMINDER
    return { on: saved.on === true, day: saved.day, minutes: saved.minutes, ...(typeof saved.next === 'number' && { next: saved.next }) }
  } catch {
    return DEFAULT_REMINDER
  }
}

function changed(): void {
  listeners.forEach((l) => l())
}

function setEndpoint(next: string | null): void {
  endpoint = next
  writeItem(KEY, next)
  // Nothing uses notifications any more: next time, turning one on starts from scratch.
  if (next === null) setRestOff(false)
  changed()
}

function setRestOff(off: boolean): void {
  restOff = off
  writeItem(REST_KEY, off ? 'off' : null)
  changed()
}

function setReminder(next: Reminder): void {
  reminder = next
  writeItem(REMINDER_KEY, JSON.stringify(next))
  changed()
}

function canPush(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function statusFor(on: boolean): PushStatus {
  if (!SERVER) return 'no-server'
  if (!canPush()) return 'not-installed'
  if (Notification.permission === 'denied') return 'denied'
  return on && endpoint && Notification.permission === 'granted' ? 'on' : 'off'
}

/** Rest alerts. */
export function pushStatus(): PushStatus {
  return statusFor(!restOff)
}

export function reminderStatus(): PushStatus {
  return statusFor(reminder.on)
}

function useStore<T>(snapshot: () => T): T {
  return useSyncExternalStore((l) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }, snapshot)
}

export function usePushStatus(): PushStatus {
  return useStore(pushStatus)
}

export function useReminderStatus(): PushStatus {
  return useStore(reminderStatus)
}

/** The reminder's time (also while it is off: the one it would ring at). */
export function useReminder(): Reminder {
  return useStore(() => reminder)
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.length) return false
  const bytes = new Uint8Array(a)
  return bytes.every((v, i) => v === b[i])
}

/**
 * This phone's push subscription with the server's key, made if needed: asks for permission
 * (call it from a tap). A status instead if notifications can't be used. Throws if the server or
 * the browser fails.
 */
async function subscribe(): Promise<PushSubscription | PushStatus> {
  if (!SERVER) return 'no-server'
  if (!canPush()) return 'not-installed'
  // iOS only asks during a tap, so this goes first.
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    changed()
    return statusFor(true)
  }
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return 'not-installed'
  const res = await fetch(`${SERVER}/key`)
  if (!res.ok) throw new Error(`El servidor de avisos respondió ${res.status}`)
  const key = fromBase64url(((await res.json()) as { publicKey: string }).publicKey)
  let subscription = await registration.pushManager.getSubscription()
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe()
    subscription = null
  }
  return subscription ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }))
}

/** Drops the subscription: neither rest alerts nor the reminder use it any more. */
async function unsubscribe(): Promise<void> {
  setEndpoint(null)
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    await (await registration?.pushManager.getSubscription())?.unsubscribe()
  } catch {
    // Nothing else to undo.
  }
}

/** Turns rest alerts on. */
export async function enablePush(): Promise<PushStatus> {
  const subscription = await subscribe()
  if (typeof subscription === 'string') return subscription
  setRestOff(false)
  setEndpoint(subscription.endpoint)
  return 'on'
}

/** Turns rest alerts off (the weekly reminder, if on, keeps working). */
export async function disablePush(): Promise<void> {
  if (endpoint) send(endpoint, null)
  if (reminder.on && endpoint) setRestOff(true)
  else await unsubscribe()
}

/** Tells the server the reminder of this subscription (null: none). Throws if the server fails. */
async function sendReminder(subscription: { endpoint: string; keys?: Record<string, string> }, time: ReminderTime | null): Promise<number | null> {
  const weekly = time && { day: time.day, minutes: time.minutes, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
  const res = await fetch(`${SERVER}/weekly`, {
    method: 'POST',
    body: JSON.stringify({ endpoint: subscription.endpoint, keys: subscription.keys, weekly }),
  })
  if (!res.ok) throw new Error(`El servidor de avisos respondió ${res.status}`)
  return ((await res.json()) as { next: number | null }).next
}

function keysOf(subscription: PushSubscription): { endpoint: string; keys?: Record<string, string> } {
  return { endpoint: subscription.endpoint, keys: subscription.toJSON().keys }
}

/** Turns the weekly reminder on, or moves it to another time. */
export async function enableReminder(time: ReminderTime): Promise<PushStatus> {
  const subscription = await subscribe()
  if (typeof subscription === 'string') return subscription
  let next: number | null
  try {
    next = await sendReminder(keysOf(subscription), time)
  } catch (e) {
    // Nothing else uses the subscription just made.
    if (!endpoint) await subscription.unsubscribe().catch(() => {})
    throw e
  }
  // Only the reminder: rest alerts stay off, as they were.
  if (!endpoint) setRestOff(true)
  setEndpoint(subscription.endpoint)
  setReminder({ on: true, day: time.day, minutes: time.minutes, ...(next !== null && { next }) })
  return 'on'
}

/** Changes the reminder's time: if it is on, the server is told at once. */
export async function setReminderTime(time: ReminderTime): Promise<void> {
  if (reminderStatus() === 'on') {
    await enableReminder(time)
    return
  }
  setReminder({ on: reminder.on, day: time.day, minutes: time.minutes })
}

/** Asks the server for the reminder now (10 seconds later), to try it. Throws if the server fails. */
export async function testReminder(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) throw new Error('No hay suscripción a los avisos: desactiva y vuelve a activar el aviso.')
  const res = await fetch(`${SERVER}/weekly/test`, { method: 'POST', body: JSON.stringify(keysOf(subscription)) })
  if (!res.ok) throw new Error(`El servidor de avisos respondió ${res.status}`)
}

/** Turns the weekly reminder off, keeping its time. */
export async function disableReminder(): Promise<void> {
  const { day, minutes } = reminder
  setReminder({ on: false, day, minutes })
  if (endpoint) await sendReminder({ endpoint }, null).catch(() => {})
  if (restOff) await unsubscribe()
}

/**
 * When the app opens: the browser may have dropped or renewed the subscription (or the permission
 * may have been taken away in iPhone Settings), so keep the saved address in step with it. The
 * reminder is sent again, in case the address or the time zone changed.
 */
export async function checkPushSubscription(): Promise<void> {
  if (!endpoint || !canPush()) return
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) return
    const subscription = await registration.pushManager.getSubscription()
    if (Notification.permission !== 'granted' || !subscription) {
      // Both are off now: each one is turned on again from Ajustes.
      setEndpoint(null)
      if (reminder.on) setReminder({ on: false, day: reminder.day, minutes: reminder.minutes })
      return
    }
    if (subscription.endpoint !== endpoint) {
      const old = endpoint
      setEndpoint(subscription.endpoint)
      if (reminder.on) await sendReminder({ endpoint: old }, null).catch(() => {})
    }
    if (reminder.on && SERVER) {
      const next = await sendReminder(keysOf(subscription), reminder)
      if (next !== null) setReminder({ ...reminder, next })
    }
  } catch {
    // Keep what we have.
  }
}

/**
 * A tap on the weekly reminder opens its page: the service worker opens the app there, or, if
 * the app was already open, tells it where to go.
 */
export function followNotificationClicks(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
    const data = e.data as { type?: unknown; hash?: unknown } | null
    if (data?.type === 'open' && typeof data.hash === 'string' && data.hash.startsWith('#/')) location.hash = data.hash
  })
}

function send(to: string, endsAt: number | null): void {
  // keepalive: the request goes out even if the iPhone is being locked right now. Plain text
  // keeps it a simple request (no CORS preflight, one round trip).
  void fetch(`${SERVER}/timer`, {
    method: 'POST',
    body: JSON.stringify({ endpoint: to, endsAt, now: Date.now() }),
    keepalive: true,
  }).catch(() => {})
}

/** Tells the server when the current rest ends (null: there is none now), if rest alerts are on. */
export function scheduleRestPush(endsAt: number | null): void {
  if (SERVER && endpoint && !restOff) send(endpoint, endsAt)
}
