import { useEffect, useSyncExternalStore } from 'react'
import { showRest } from './liveActivity'
import { isNativeApp } from './native'
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
// The iPhone app opened again (iOS closes apps in the background when it needs the memory): a rest
// in progress goes on ringing at its end (see scheduleRestPush) and showing on the lock screen;
// otherwise what was left there goes away.
if (isNativeApp) {
  if (state) scheduleRestPush(state.endsAt)
  showRest(state)
}

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
 * the phone when the rest ends if the app is in the background (see lib/push), and in the iPhone
 * app it shows on the lock screen (lib/liveActivity).
 */
export const restTimer = {
  start(seconds: number, key?: string) {
    if (seconds <= 0) return
    primeAudio()
    set({ endsAt: Date.now() + seconds * 1000, total: seconds, key })
    scheduleRestPush(state?.endsAt ?? null)
    showRest(state)
  },
  adjust(deltaSeconds: number) {
    if (!state) return
    primeAudio()
    const endsAt = state.endsAt + deltaSeconds * 1000
    if (endsAt <= Date.now()) {
      restTimer.skip()
      return
    }
    set({ ...state, endsAt, total: Math.max(1, state.total + deltaSeconds) })
    scheduleRestPush(state.endsAt)
    showRest(state)
  },
  /**
   * Skipped, or shortened to nothing: it is over now, as if it had run out. The ping sounds and the
   * iPhone vibrates, its notification is cancelled, and the lock screen says it is over, with the
   * next set.
   */
  skip() {
    if (!state) return
    primeAudio()
    const { total } = state
    scheduleRestPush(null)
    set(null)
    showRest({ endsAt: Date.now(), total })
    signalRestOver()
  },
  /**
   * The workout is over or discarded, or the set's rest was taken away: the notification is cancelled
   * too, and the rest leaves the lock screen (also once over, when it stays there with the next set).
   */
  stop() {
    if (state) scheduleRestPush(null)
    set(null)
    showRest(null)
  },
  /** The rest ran out with the app open: the notification still comes (it vibrates). */
  expire() {
    set(null)
  },
  /**
   * An exercise or a set was moved or deleted: the rest keeps running, shown under the same set
   * (or only in the rest bar, if its set is gone). See followIndex.
   */
  follow(prefix: string, map: (index: number) => number | undefined) {
    if (!state) return
    const key = followIndex(state.key, prefix, map)
    if (key !== state.key) set({ ...state, key })
  },
}

/**
 * A rest's key is "<workout id>:<exercise index>:<set index>" (see ExerciseCard). This maps the
 * index right after `prefix` ("<workout id>:" for exercises, "<workout id>:<exercise index>:" for
 * sets); undefined if what it was under is gone.
 */
export function followIndex(key: string | undefined, prefix: string, map: (index: number) => number | undefined): string | undefined {
  if (!key?.startsWith(prefix)) return key
  const m = /^(\d+)(:.*)?$/.exec(key.slice(prefix.length))
  if (!m) return key
  const index = map(Number(m[1]))
  return index === undefined ? undefined : `${prefix}${index}${m[2] ?? ''}`
}

/** Where each index goes when the item at `at` is deleted. */
export const afterRemoving =
  (at: number) =>
  (i: number): number | undefined =>
    i === at ? undefined : i > at ? i - 1 : i

/** Where each index goes when the item at `from` is moved to `to`. */
export const afterMoving =
  (from: number, to: number) =>
  (i: number): number => {
    if (i === from) return to
    if (from < to && i > from && i <= to) return i - 1
    if (to < from && i >= to && i < from) return i + 1
    return i
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
