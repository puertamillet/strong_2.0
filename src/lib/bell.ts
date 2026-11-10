/**
 * Boxing-ring bell ("ding, ding, ding") synthesised with Web Audio, so there is no
 * sound file to download or cache. Each strike is a short hammer click plus a set of
 * inharmonic partials that ring and fade out at different rates, after Jean-Claude
 * Risset's classic additive bell. Two pairs of partials are detuned by 1-2 Hz to get
 * the slow shimmer of a real bell.
 */

/** [frequency ratio, detune in Hz, relative amplitude, relative ring time] */
const PARTIALS: readonly (readonly [number, number, number, number])[] = [
  [0.56, 0, 1, 1],
  [0.56, 1, 0.67, 0.9],
  [0.92, 0, 1, 0.65],
  [0.92, 1.7, 1.8, 0.55],
  [1.19, 0, 2.67, 0.325],
  [1.7, 0, 1.67, 0.35],
  [2, 0, 1.46, 0.25],
  [2.74, 0, 1.33, 0.2],
  [3, 0, 1.33, 0.15],
  [3.76, 0, 1, 0.1],
  [4.07, 0, 1.33, 0.075],
]
const TOTAL_AMPLITUDE = PARTIALS.reduce((sum, p) => sum + p[2], 0)

export interface BellOptions {
  /** Base frequency in Hz; the partials go from 0.56× to 4.07× this. */
  pitch?: number
  /** Number of strikes. */
  strikes?: number
  /** Seconds between strikes. */
  gap?: number
  /** Seconds the longest partial rings after each strike. */
  ring?: number
  /** Output gain. */
  volume?: number
}

export const BELL_DEFAULTS: Required<BellOptions> = { pitch: 1200, strikes: 3, gap: 0.4, ring: 2.5, volume: 1.1 }

/** Schedules the bell on `ctx` right away and returns how long it lasts, in seconds. */
export function ringBell(ctx: BaseAudioContext, options: BellOptions = {}, destination: AudioNode = ctx.destination): number {
  const { pitch, strikes, gap, ring, volume } = { ...BELL_DEFAULTS, ...options }
  const out = ctx.createGain()
  out.gain.value = volume
  out.connect(destination)

  const click = hammerClick(ctx)
  const start = ctx.currentTime + 0.02
  for (let i = 0; i < strikes; i++) {
    const t = start + i * gap
    for (const [ratio, detune, amplitude, ringTime] of PARTIALS) {
      const osc = ctx.createOscillator()
      osc.frequency.value = pitch * ratio + detune
      const env = ctx.createGain()
      const end = t + ring * ringTime
      env.gain.setValueAtTime(0, t)
      env.gain.linearRampToValueAtTime(amplitude / TOTAL_AMPLITUDE, t + 0.002)
      env.gain.exponentialRampToValueAtTime(0.0001, end)
      osc.connect(env).connect(out)
      osc.start(t)
      osc.stop(end + 0.01)
    }
    const hit = ctx.createBufferSource()
    hit.buffer = click
    const bright = ctx.createBiquadFilter()
    bright.type = 'highpass'
    bright.frequency.value = 2500
    const level = ctx.createGain()
    level.gain.value = 0.3
    hit.connect(bright).connect(level).connect(out)
    hit.start(t)
  }
  return start - ctx.currentTime + (strikes - 1) * gap + ring
}

/** 20 ms of noise with a sharp decay: the hammer hitting the metal. */
function hammerClick(ctx: BaseAudioContext): AudioBuffer {
  const length = Math.ceil(ctx.sampleRate * 0.02)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3
  return buffer
}
