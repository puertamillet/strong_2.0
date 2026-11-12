/**
 * The ping at the end of a rest: one short, high "ping". A sine near 2 kHz (where the iPhone
 * speaker is loud and the sound cuts through the gym's noise) with a 3 ms attack and an
 * exponential fade, plus two quieter overtones that fade sooner and give it a metallic edge.
 *
 * The web app plays it with Web Audio (sound.ts). The iPhone app plays it from a sound file made
 * from the same numbers (pingWav, which vite.config.ts puts in the build as sounds/ping.wav), and
 * its rest notifications ring with that file too (native/strong-native).
 */

/** [frequency ratio, relative amplitude, relative ring time] */
export const PARTIALS: readonly (readonly [number, number, number])[] = [
  [1, 1, 1],
  [2, 0.25, 0.4],
  [3, 0.06, 0.2],
]
export const TOTAL_AMPLITUDE = PARTIALS.reduce((sum, p) => sum + p[1], 0)

/** Seconds from silence to full volume. */
export const ATTACK = 0.003
/** The level each partial fades down to (an exponential fade never reaches 0). */
export const FADED = 0.0001

export interface PingOptions {
  /** Frequency in Hz. */
  pitch?: number
  /** Seconds until it has faded out. */
  ring?: number
  /** Output gain. */
  volume?: number
}

export const PING_DEFAULTS: Required<PingOptions> = { pitch: 1976, ring: 0.9, volume: 0.9 }

/** The ping as samples from -1 to 1, as Web Audio plays it (see playPing in sound.ts). */
export function renderPing(sampleRate: number, options: PingOptions = {}): Float32Array {
  const { pitch, ring, volume } = { ...PING_DEFAULTS, ...options }
  const samples = new Float32Array(Math.ceil(ring * sampleRate))
  for (const [ratio, amplitude, ringTime] of PARTIALS) {
    const peak = amplitude / TOTAL_AMPLITUDE
    const end = ring * ringTime
    for (let i = 0; i < samples.length && i / sampleRate < end; i++) {
      const t = i / sampleRate
      const level = t < ATTACK ? (peak * t) / ATTACK : peak * (FADED / peak) ** ((t - ATTACK) / (end - ATTACK))
      samples[i] += volume * level * Math.sin(2 * Math.PI * pitch * ratio * t)
    }
  }
  return samples
}

/** The ping as a WAV file: 16-bit mono PCM, the format iOS plays and rings notifications with. */
export function pingWav(sampleRate = 44100): Uint8Array {
  const samples = renderPing(sampleRate)
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  view.setUint32(4, bytes.length - 8, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // size of this chunk
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // bytes per second
  view.setUint16(32, 2, true) // bytes per sample
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, s)) * 32767), true))
  return bytes
}
