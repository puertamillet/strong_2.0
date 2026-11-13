import { describe, expect, it } from 'vitest'
import { PING_DEFAULTS, PING_LENGTH, pingWav, renderPing } from '../lib/ping'

/** How strongly `samples` contain a sine at `frequency` Hz (Goertzel). */
function strength(samples: Float32Array, sampleRate: number, frequency: number): number {
  const k = 2 * Math.cos((2 * Math.PI * frequency) / sampleRate)
  let a = 0
  let b = 0
  for (const s of samples) [a, b] = [s + k * a - b, a]
  return Math.sqrt(a * a + b * b - k * a * b) / samples.length
}

describe('the ping as a sound file, for the iPhone app', () => {
  it('is a WAV file iOS can play and ring notifications with: 16-bit mono PCM, under 30 seconds', () => {
    const wav = pingWav()
    const view = new DataView(wav.buffer)
    const text = (at: number) => String.fromCharCode(...wav.slice(at, at + 4))
    expect([text(0), text(8), text(12), text(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data'])
    expect(view.getUint32(4, true)).toBe(wav.length - 8)
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(44100)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(wav.length - 44)
    expect((wav.length - 44) / 2 / 44100).toBeCloseTo(PING_LENGTH, 2)
    expect(PING_LENGTH).toBeLessThan(3)
  })

  it('sounds like Strong’s: two bright, metallic strikes 0.2 s apart, over a low body, that ring on and fade out', () => {
    const rate = 44100
    const samples = renderPing(rate)
    const between = (from: number, to: number) => samples.slice(Math.round(from * rate), Math.round(to * rate))
    const peak = Math.max(...samples.map(Math.abs))
    expect(peak).toBeGreaterThan(0.8 * PING_DEFAULTS.volume)
    expect(peak).toBeLessThanOrEqual(1.001 * PING_DEFAULTS.volume)
    // It starts from silence and ends in it, without clicks.
    expect(samples[0]).toBe(0)
    expect(Math.max(...samples.slice(-441).map(Math.abs))).toBeLessThan(0.001)
    // Two strikes: the brightest partial, which fades fast, is back at 0.2 s.
    const beforeSecond = strength(between(0.15, 0.2), rate, 6519.8)
    expect(strength(between(0, 0.05), rate, 6519.8)).toBeGreaterThan(4 * beforeSecond)
    expect(strength(between(0.2, 0.25), rate, 6519.8)).toBeGreaterThan(4 * beforeSecond)
    // Metallic: high partials that are not multiples of one note, up to the air above 12 kHz…
    const strike = between(0, 0.05)
    const bright = strength(strike, rate, 6519.8)
    for (const partial of [1871, 3308.7, 4635.7, 9112.5]) expect(strength(strike, rate, partial)).toBeGreaterThan(bright / 4)
    for (const partial of [12016.3, 15251.9]) expect(strength(strike, rate, partial)).toBeGreaterThan(bright / 20)
    expect(strength(strike, rate, 1871 * 2)).toBeLessThan(bright / 10)
    // …over a low body at 900 Hz, and nothing lower than the bell.
    expect(strength(strike, rate, 900)).toBeGreaterThan(bright / 8)
    expect(strength(strike, rate, 440)).toBeLessThan(bright / 20)
    // Then it rings on at 2174 Hz, the bright partial that fades the slowest, and the low ones.
    const ring = between(1, 1.5)
    const hum = strength(ring, rate, 2173.5)
    for (const partial of [1871, 3308.7, 4295, 6519.8]) expect(strength(ring, rate, partial)).toBeLessThan(hum / 2)
    for (const partial of [587.6, 1246.1]) expect(strength(ring, rate, partial)).toBeGreaterThan(hum / 8)
  })
})
