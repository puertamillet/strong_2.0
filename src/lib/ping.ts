/**
 * The sound at the end of a rest: a double «ding», two strikes of a small metal bell 0.2 s apart,
 * like the one Strong plays. Each strike is a few dozen sines at the bell's inharmonic partials,
 * measured from a recording of that sound and fitted to its spectrogram: a low body from 588 to
 * 1246 Hz, which gives it weight; the bright partials up to 15 kHz, which start sharply and fade
 * fast, some in close pairs that shimmer; and the one at 2174 Hz, which swells for a moment and
 * rings on the longest.
 *
 * The web app plays it with Web Audio (sound.ts). The iPhone app plays it from a sound file made
 * from the same numbers (pingWav, which vite.config.ts puts in the build as sounds/ping.wav), and
 * its rest notifications ring with that file too (native/strong-native).
 */

/**
 * [frequency in Hz, relative level in dB, fade in dB per second, attack in seconds]. Two partials
 * a hertz or two apart are one that already sounds at the strike (the fast one) and then swells
 * (the slow one).
 */
export const PARTIALS: readonly (readonly [number, number, number, number])[] = [
  [587.6, -27.5, 27, 0.09],
  [900, -15.5, 105, 0.0003],
  [1174.2, -31.5, 34, 0.21],
  [1246.1, -23.5, 33, 0.01],
  [1871, -2.5, 82, 0.0003],
  [2173.5, -11, 44, 0.25],
  [2174.5, -22.5, 112, 0.0003],
  [2474.1, -17, 40, 0.14],
  [2476, -30, 100, 0.0003],
  [3308.7, -7, 63, 0.04],
  [3667.5, -7.5, 276, 0.0003],
  [3726.2, -17.5, 91, 0.0003],
  [3890.8, -7.5, 80, 0.0003],
  [4295, -13.5, 48, 0.12],
  [4431.6, -9, 128, 0.0003],
  [4635.7, -6, 106, 0.0003],
  [5356.6, -21, 78, 0.0003],
  [6132.9, -21, 99, 0.0003],
  [6519.8, -1.5, 103, 0.0003],
  [7392.4, -22.5, 160, 0.0003],
  [7690.6, -16, 90, 0.0003],
  [8621.5, -29, 135, 0.0003],
  [9103.8, -21, 263, 0.0003],
  [9112.5, -6, 119, 0.0003],
  [10573.2, -19, 110, 0.0003],
  [10583.4, -29.5, 191, 0.0003],
  [12016.3, -11.5, 138, 0.0003],
  [14170.5, -27, 138, 0.0003],
  [15251.9, -20.5, 173, 0.0003],
]

/** When each strike starts, in seconds. */
export const STRIKES: readonly number[] = [0, 0.2]

/** The level each partial fades down to (an exponential fade never reaches 0). */
export const FADED = 0.0001

/** Scales the partials so that the loudest moment of the two strikes is 1 at full volume. */
export const GAIN = 0.3358434

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
