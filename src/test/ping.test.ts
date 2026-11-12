import { describe, expect, it } from 'vitest'
import { PING_DEFAULTS, pingWav, renderPing } from '../lib/ping'

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
    expect((wav.length - 44) / 2 / 44100).toBeCloseTo(PING_DEFAULTS.ring, 2)
  })

  it('sounds like the web app’s ping: a high note that rings and fades out, without clicks', () => {
    const rate = 44100
    const samples = renderPing(rate)
    const peak = Math.max(...samples.map(Math.abs))
    expect(peak).toBeGreaterThan(0.5)
    expect(peak).toBeLessThanOrEqual(PING_DEFAULTS.volume)
    // It starts from silence and ends in it.
    expect(samples[0]).toBe(0)
    expect(Math.max(...samples.slice(-441).map(Math.abs))).toBeLessThan(0.001)
    // Its note, above its two overtones.
    const start = samples.slice(0, rate / 10)
    const note = strength(start, rate, PING_DEFAULTS.pitch)
    expect(strength(start, rate, PING_DEFAULTS.pitch * 2)).toBeLessThan(note / 2)
    expect(strength(start, rate, PING_DEFAULTS.pitch * 3)).toBeLessThan(note / 2)
    expect(strength(start, rate, 440)).toBeLessThan(note / 20)
  })
})
