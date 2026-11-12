import { useEffect, useSyncExternalStore } from 'react'
import { isNativeApp, StrongNative } from './native'

/**
 * Keeps the screen on during a workout (Screen Wake Lock API; natively in the iPhone app), so the
 * phone only locks when you lock it yourself. It's a setting, on by default.
 */
const KEY = 'strong2.keepAwake'
const listeners = new Set<() => void>()
let enabled = readSetting()

function readSetting(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function setKeepAwake(on: boolean): void {
  enabled = on
  try {
    if (on) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, 'off')
  } catch {
    // Storage unavailable; the setting lasts until the app closes.
  }
  listeners.forEach((l) => l())
}

export function useKeepAwakeSetting(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => enabled,
  )
}

export const wakeLockSupported = isNativeApp || (typeof navigator !== 'undefined' && 'wakeLock' in navigator)

/**
 * Holds a screen wake lock while `active`. The browser drops the lock whenever the
 * app is hidden, so it is requested again when the app comes back, and on the next
 * tap in case the first request was refused.
 */
export function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !wakeLockSupported) return
    if (isNativeApp) {
      // iOS keeps it while the app is open, also after going to another app and back.
      void StrongNative.keepAwake({ on: true }).catch(() => {})
      return () => void StrongNative.keepAwake({ on: false }).catch(() => {})
    }
    let lock: WakeLockSentinel | null = null
    let pending = false
    let stopped = false

    const request = async () => {
      if (stopped || pending || document.visibilityState !== 'visible' || (lock && !lock.released)) return
      pending = true
      try {
        const next = await navigator.wakeLock.request('screen')
        if (stopped) void next.release()
        else lock = next
      } catch {
        // Refused (for example in Low Power Mode); try again on the next tap.
      } finally {
        pending = false
      }
    }

    void request()
    document.addEventListener('visibilitychange', request)
    document.addEventListener('pointerdown', request, { passive: true })
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', request)
      document.removeEventListener('pointerdown', request)
      void lock?.release().catch(() => {})
    }
  }, [active])
}
