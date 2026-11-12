import { haptic } from './haptics'

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
 * The ping plays over whatever the iPhone is playing (a podcast, music) and never pauses it: that
 * is iOS's "ambient" audio, which Safari uses for Web Audio and which is asked for here anyway where
 * the Audio Session API exists (Safari 17+). The price is that with the iPhone in silent mode the
 * ping doesn't sound, and then the notification's vibration is the warning. Sounding in silent
 * mode takes "playback" audio, which pauses the podcast, and iOS doesn't give it back afterwards.
 */
function mixWithOtherAudio(): void {
  try {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
    if (session && session.type !== 'ambient') session.type = 'ambient'
  } catch {
    // No Audio Session API: Web Audio is ambient anyway.
  }
}

/**
 * Gets the shared audio context running. iOS only lets a page play sound from a context started
 * during a tap, so this runs when a rest starts (the tap on ✓) and the ping uses the same context
 * when the rest is over; after the ping it is closed (see signalRestOver).
 */
export function primeAudio(): AudioContext | null {
  try {
    mixWithOtherAudio()
    if (!audio) {
      const Ctx =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return null
      audio = new Ctx()
    }
    clearTimeout(release)
    if (audio.state !== 'running') void audio.resume().catch(() => {})
    return audio
  } catch {
    return null
  }
}

let release: ReturnType<typeof setTimeout> | undefined

/**
 * The ping, plus a vibration where the browser can, when the rest is over. On iPhone a web app can't
 * vibrate on its own (see haptics): the notification, which also comes with the app open, does. When
 * the ping has sounded the audio context is closed, so the page holds no audio while you rest; the
 * next rest opens a new one (see primeAudio).
 */
export function signalRestOver(): void {
  haptic([200, 100, 200])
  try {
    const ctx = primeAudio()
    if (!ctx) return
    const seconds = playPing(ctx)
    clearTimeout(release)
    release = setTimeout(() => {
      if (audio === ctx) audio = null
      void ctx.close().catch(() => {})
    }, (seconds + 0.3) * 1000)
  } catch {
    // Audio not available.
  }
}
