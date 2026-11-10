import { useSyncExternalStore } from 'react'

/**
 * Rest notifications with the iPhone locked or in another app (Web Push).
 *
 * A web app in the background is frozen and can't ring, so when a rest starts the app tells a
 * small server (push-server/, a free Cloudflare Worker) when it ends, and at that moment the
 * server asks Apple to wake the app, which shows a notification (public/push-sw.js). The server
 * only gets this phone's push address and the time; the text is made here, on the phone.
 *
 * On iPhone it needs iOS 16.4+, the app added to the home screen and permission to notify.
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

const KEY = 'strong2.pushEndpoint'
const listeners = new Set<() => void>()
let endpoint = readEndpoint()

function readEndpoint(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

function setEndpoint(next: string | null): void {
  endpoint = next
  try {
    if (next) localStorage.setItem(KEY, next)
    else localStorage.removeItem(KEY)
  } catch {
    // Storage unavailable; the setting lasts until the app closes.
  }
  listeners.forEach((l) => l())
}

function canPush(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function pushStatus(): PushStatus {
  if (!SERVER) return 'no-server'
  if (!canPush()) return 'not-installed'
  if (Notification.permission === 'denied') return 'denied'
  return endpoint && Notification.permission === 'granted' ? 'on' : 'off'
}

export function usePushStatus(): PushStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    pushStatus,
  )
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
 * Turns notifications on: asks for permission (call it from a tap), subscribes this phone with the
 * server's key and remembers its push address. Throws if the server or the browser fails.
 */
export async function enablePush(): Promise<PushStatus> {
  if (!SERVER) return 'no-server'
  if (!canPush()) return 'not-installed'
  // iOS only asks during a tap, so this goes first.
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    listeners.forEach((l) => l())
    return pushStatus()
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
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  setEndpoint(subscription.endpoint)
  return 'on'
}

export async function disablePush(): Promise<void> {
  const old = endpoint
  setEndpoint(null)
  if (old) send(old, null)
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    await (await registration?.pushManager.getSubscription())?.unsubscribe()
  } catch {
    // Nothing else to undo.
  }
}

/**
 * When the app opens: the browser may have dropped or renewed the subscription (or the permission
 * may have been taken away in iPhone Settings), so keep the saved address in step with it.
 */
export async function checkPushSubscription(): Promise<void> {
  if (!endpoint || !canPush()) return
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) return
    const subscription = await registration.pushManager.getSubscription()
    if (Notification.permission !== 'granted' || !subscription) setEndpoint(null)
    else if (subscription.endpoint !== endpoint) setEndpoint(subscription.endpoint)
  } catch {
    // Keep what we have.
  }
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

/** Tells the server when the current rest ends (null: there is none now), if notifications are on. */
export function scheduleRestPush(endsAt: number | null): void {
  if (SERVER && endpoint) send(endpoint, endsAt)
}
