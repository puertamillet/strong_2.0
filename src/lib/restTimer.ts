import { useEffect, useSyncExternalStore } from 'react'
import { scheduleRestPush } from './push'
import { primeAudio, signalRestOver } from './sound'

/** Seconds added or taken away by the rest bar's − and + buttons. */
export const REST_STEP = 10

/**
 * Global rest timer. Stored as an absolute end time so it stays correct when the
 * app is backgrounded or reloaded.
 */
export interface RestTimerState {
  endsAt: number
  total: number
  /** The set whose rest this is (see ExerciseCard), to show the countdown under it. */
  key?: string
}

const KEY = 'strong2.restTimer'
const listeners = new Set<() => void>()
let state: RestTimerState | null = load()

function load(): RestTimerState | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as RestTimerState
    return s.endsAt > Date.now() ? s : null
  } catch {
    return null
  }
}

function set(next: RestTimerState | null) {
  state = next
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next))
    else localStorage.removeItem(KEY)
  } catch {
    // Storage unavailable; timer still works in memory.
  }
  listeners.forEach((l) => l())
}

/**
 * The rest timer. Starting, changing or stopping it also tells the push server, which notifies
 * the phone when the rest ends if the app is in the background (see lib/push).
 */
export const restTimer = {
  start(seconds: number, key?: string) {
    if (seconds <= 0) return
    primeAudio()
    set({ endsAt: Date.now() + seconds * 1000, total: seconds, key })
    scheduleRestPush(state?.endsAt ?? null)
  },
  adjust(deltaSeconds: number) {
    if (!state) return
    primeAudio()
    const endsAt = state.endsAt + deltaSeconds * 1000
    if (endsAt <= Date.now()) set(null)
    else set({ ...state, endsAt, total: Math.max(1, state.total + deltaSeconds) })
    scheduleRestPush(state?.endsAt ?? null)
  },
  /** Skipped, or the workout is over: the notification is cancelled too. */
  stop() {
    if (state) scheduleRestPush(null)
    set(null)
  },
  /** The rest ran out with the app open: the notification still comes (it vibrates). */
  expire() {
    set(null)
  },
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useRestTimer(): RestTimerState | null {
  return useSyncExternalStore(subscribe, () => state)
}

/**
 * Pings when the rest is over. Mounted once for the whole app, so it works whether the
 * workout is open, minimised or behind another sheet.
 */
export function useRestAlarm(): void {
  const timer = useRestTimer()
  useEffect(() => {
    if (!timer) return
    const t = setInterval(() => {
      const now = Date.now()
      if (now < timer.endsAt) return
      restTimer.expire()
      // Don't ring late when coming back to the app long after the rest ended.
      if (document.visibilityState === 'visible' && now - timer.endsAt < 2000) signalRestOver()
    }, 250)
    return () => clearInterval(t)
  }, [timer])
}
