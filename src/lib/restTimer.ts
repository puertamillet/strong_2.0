import { useEffect, useSyncExternalStore } from 'react'
import { ringBell } from './bell'

/** Seconds added or taken away by the rest bar's − and + buttons. */
export const REST_STEP = 10

/**
 * Global rest timer. Stored as an absolute end time so it stays correct when the
 * app is backgrounded or reloaded.
 */
export interface RestTimerState {
  endsAt: number
  total: number
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

export const restTimer = {
  start(seconds: number) {
    if (seconds <= 0) return
    primeAudio()
    set({ endsAt: Date.now() + seconds * 1000, total: seconds })
  },
  adjust(deltaSeconds: number) {
    if (!state) return
    primeAudio()
    const endsAt = state.endsAt + deltaSeconds * 1000
    if (endsAt <= Date.now()) set(null)
    else set({ endsAt, total: Math.max(1, state.total + deltaSeconds) })
  },
  stop() {
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
 * Rings the bell when the rest is over. Mounted once for the whole app, so it works
 * whether the workout is open, minimised or behind another sheet.
 */
export function useRestAlarm(): void {
  const timer = useRestTimer()
  useEffect(() => {
    if (!timer) return
    const t = setInterval(() => {
      const now = Date.now()
      if (now < timer.endsAt) return
      restTimer.stop()
      // Don't ring late when coming back to the app long after the rest ended.
      if (document.visibilityState === 'visible' && now - timer.endsAt < 2000) signalRestOver()
    }, 250)
    return () => clearInterval(t)
  }, [timer])
}

let audio: AudioContext | null = null

/**
 * Gets the shared audio context running. iOS only lets a page play sound from a
 * context started during a tap, so this runs when a rest starts (the tap on ✓) and
 * the bell reuses the same context when the rest is over.
 */
export function primeAudio(): AudioContext | null {
  try {
    if (!audio) {
      const Ctx =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return null
      audio = new Ctx()
    }
    if (audio.state !== 'running') void audio.resume().catch(() => {})
    return audio
  } catch {
    return null
  }
}

/** Boxing-ring bell, plus a vibration where supported (not on iPhone), when the rest is over. */
export function signalRestOver(): void {
  try {
    navigator.vibrate?.([200, 100, 200])
  } catch {
    // ignore
  }
  try {
    const ctx = primeAudio()
    if (ctx) ringBell(ctx)
  } catch {
    // Audio not available.
  }
}
