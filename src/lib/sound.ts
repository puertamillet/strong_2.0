import { useSyncExternalStore } from 'react'

/**
 * The sound at the end of a rest: one short, high "ping", synthesised with Web Audio so there is
 * no sound file to download or cache. A sine near 2 kHz (where the iPhone speaker is loud and the
 * sound cuts through the gym's noise) with a 3 ms attack and an exponential fade, plus two quieter
 * overtones that fade sooner and give it a metallic edge.
 */

/** [frequency ratio, relative amplitude, relative ring time] */
const PARTIALS: readonly (readonly [number, number, number])[] = [
  [1, 1, 1],
  [2, 0.25, 0.4],
  [3, 0.06, 0.2],
]
const TOTAL_AMPLITUDE = PARTIALS.reduce((sum, p) => sum + p[1], 0)

export interface PingOptions {
  /** Frequency in Hz. */
  pitch?: number
  /** Seconds until it has faded out. */
  ring?: number
  /** Output gain. */
  volume?: number
}

export const PING_DEFAULTS: Required<PingOptions> = { pitch: 1976, ring: 0.9, volume: 0.9 }

/** Schedules the ping on `ctx` in `delay` seconds and returns how long until it is over, in seconds. */
export function playPing(
  ctx: BaseAudioContext,
  options: PingOptions = {},
  destination: AudioNode = ctx.destination,
  delay = 0.03,
): number {
  const { pitch, ring, volume } = { ...PING_DEFAULTS, ...options }
  const out = ctx.createGain()
  out.gain.value = volume
  out.connect(destination)
  const t = ctx.currentTime + delay
  for (const [ratio, amplitude, ringTime] of PARTIALS) {
    const osc = ctx.createOscillator()
    osc.frequency.value = pitch * ratio
    const env = ctx.createGain()
    const end = t + ring * ringTime
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(amplitude / TOTAL_AMPLITUDE, t + 0.003)
    env.gain.exponentialRampToValueAtTime(0.0001, end)
    osc.connect(env).connect(out)
    osc.start(t)
    osc.stop(end + 0.01)
  }
  return delay + ring
}

let audio: AudioContext | null = null

/**
 * Gets the shared audio context running. iOS only lets a page play sound from a context started
 * during a tap, so this runs when a rest starts (the tap on ✓) and the ping reuses the same
 * context when the rest is over.
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

/**
 * Sound with the iPhone in silent mode. Web Audio follows the silent switch, unless the page asks
 * for "playback" audio (Audio Session API, Safari 17+), like a music app. Playback audio pauses
 * other apps' music or podcast, so it is a setting (off by default) and only asked for while the
 * ping sounds.
 */
type AudioSessionType = 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record'

function audioSession(): { type: AudioSessionType } | undefined {
  return (navigator as Navigator & { audioSession?: { type: AudioSessionType } }).audioSession
}

export const silentModeSoundSupported = typeof navigator !== 'undefined' && 'audioSession' in navigator

const SILENT_KEY = 'strong2.soundInSilentMode'
const listeners = new Set<() => void>()
let soundInSilentMode = readSetting()

function readSetting(): boolean {
  try {
    return localStorage.getItem(SILENT_KEY) === 'on'
  } catch {
    return false
  }
}

export function setSoundInSilentMode(on: boolean): void {
  soundInSilentMode = on
  try {
    if (on) localStorage.setItem(SILENT_KEY, 'on')
    else localStorage.removeItem(SILENT_KEY)
  } catch {
    // Storage unavailable; the setting lasts until the app closes.
  }
  listeners.forEach((l) => l())
}

export function useSoundInSilentMode(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => soundInSilentMode,
  )
}

let sessionReset: ReturnType<typeof setTimeout> | undefined

/** The ping, plus a vibration where the browser can (not on iPhone), when the rest is over. */
export function signalRestOver(): void {
  try {
    navigator.vibrate?.([200, 100, 200])
  } catch {
    // Not supported.
  }
  try {
    const ctx = primeAudio()
    if (!ctx) return
    const session = soundInSilentMode ? audioSession() : undefined
    if (session) session.type = 'playback'
    // A little later with a playback session, so iOS has switched to it when the ping starts.
    const seconds = playPing(ctx, {}, ctx.destination, session ? 0.12 : 0.03)
    if (session) {
      clearTimeout(sessionReset)
      sessionReset = setTimeout(() => {
        session.type = 'auto'
      }, (seconds + 0.3) * 1000)
    }
  } catch {
    // Audio not available.
  }
}
