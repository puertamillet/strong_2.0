import { useSyncExternalStore } from 'react'

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
    set({ endsAt: Date.now() + seconds * 1000, total: seconds })
  },
  adjust(deltaSeconds: number) {
    if (!state) return
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

/** Short beep + vibration when the rest is over (only while the app is visible). */
export function signalRestOver(): void {
  try {
    navigator.vibrate?.([200, 100, 200])
  } catch {
    // ignore
  }
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const beep = (at: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.3, ctx.currentTime + at)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.25)
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + at)
      osc.stop(ctx.currentTime + at + 0.25)
    }
    beep(0)
    beep(0.35)
    setTimeout(() => void ctx.close(), 1000)
  } catch {
    // Audio not available.
  }
}
