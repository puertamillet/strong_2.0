/**
 * The sound at the end of a rest: a double «ding», two strikes of a small metal bell 0.2 s apart,
 * like the one Strong plays. Each strike is a handful of sines at the bell's inharmonic partials
 * (measured from a recording of that sound): the high ones give the bright, metallic attack and
 * fade quickly, and the one at 2174 Hz swells for a moment and rings on the longest.
 *
 * The web app plays it with Web Audio (sound.ts). The iPhone app plays it from a sound file made
 * from the same numbers (pingWav, which vite.config.ts puts in the build as sounds/ping.wav), and
 * its rest notifications ring with that file too (native/strong-native).
 */

/** [frequency in Hz, level in dB below the loudest partial, fade in dB per second, attack in seconds] */
export const PARTIALS: readonly (readonly [number, number, number, number])[] = [
  [1870, -2, 96, 0.002],
  [2174, -11, 30, 0.15],
  [2474, -16, 30, 0.15],
  [3308, -7, 52, 0.002],
  [3891, -9, 80, 0.002],
  [4294, -9.5, 45, 0.002],
  [4636, -6.5, 130, 0.002],
  [6519, 0, 110, 0.002],
  [9113, -6, 112, 0.002],
]

/** When each strike starts, in seconds. */
export const STRIKES: readonly number[] = [0, 0.2]

/** The level each partial fades down to (an exponential fade never reaches 0). */
export const FADED = 0.0001

/** Scales the partials so that the loudest moment of the two strikes is 1 at full volume. */
export const GAIN = 0.3146636

export interface PingOptions {
  /** Output gain, from 0 to 1. */
  volume?: number
}

export const PING_DEFAULTS: Required<PingOptions> = { volume: 0.9 }

/** One sine of the ping. Times in seconds from the start of the ping. */
export interface Note {
  frequency: number
  start: number
  /** Its level when the attack is over, before the volume; from there it fades exponentially. */
  peak: number
  /** When it is at its peak. */
  attack: number
  /** When it has faded down to FADED. */
  end: number
}

/** Every sine of both strikes. */
export const NOTES: readonly Note[] = STRIKES.flatMap((start) =>
  PARTIALS.map(([frequency, db, fade, attack]) => {
    const peak = GAIN * 10 ** (db / 20)
    const fadeTime = (20 * Math.log10(peak / FADED)) / fade
    return { frequency, start, peak, attack: start + attack, end: start + attack + fadeTime }
  }),
)

/** Seconds until the ping has faded out. */
export const PING_LENGTH = Math.max(...NOTES.map((note) => note.end))

/** The ping as samples from -1 to 1, as Web Audio plays it (see playPing in sound.ts). */
export function renderPing(sampleRate: number, options: PingOptions = {}): Float32Array {
  const { volume } = { ...PING_DEFAULTS, ...options }
  const samples = new Float32Array(Math.ceil(PING_LENGTH * sampleRate))
  for (const { frequency, start, peak, attack, end } of NOTES) {
    const last = Math.min(samples.length, Math.ceil(end * sampleRate))
    for (let i = Math.ceil(start * sampleRate); i < last; i++) {
      const t = i / sampleRate
      const level =
        t < attack ? (peak * (t - start)) / (attack - start) : peak * (FADED / peak) ** ((t - attack) / (end - attack))
      samples[i] += volume * level * Math.sin(2 * Math.PI * frequency * (t - start))
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
