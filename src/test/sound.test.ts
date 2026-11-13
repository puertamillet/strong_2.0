import { afterEach, describe, expect, it, vi } from 'vitest'

describe('the ping at the end of a rest', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('plays over the podcast without pausing it, and lets go of the audio afterwards', async () => {
    vi.useFakeTimers()
    // Every audio session type the page asks for (Audio Session API, Safari 17+).
    const types: string[] = []
    const audioSession = {
      get type() {
        return types.at(-1) ?? 'auto'
      },
      set type(type: string) {
        types.push(type)
      },
    }
    const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() })
    const contexts: FakeContext[] = []
    class FakeContext {
      state = 'suspended'
      currentTime = 0
      destination = {}
      closed = false
      constructor() {
        contexts.push(this)
      }
      resume() {
        this.state = 'running'
        return Promise.resolve()
      }
      close() {
        this.closed = true
        return Promise.resolve()
      }
      createGain() {
        return { gain: param(), connect: (node: unknown) => node }
      }
      createOscillator() {
        return { frequency: param(), connect: (node: unknown) => node, start: vi.fn(), stop: vi.fn() }
      }
    }
    vi.stubGlobal('navigator', { audioSession })
    vi.stubGlobal('window', { AudioContext: FakeContext })
    vi.resetModules()
    const { primeAudio, signalRestOver } = await import('../lib/sound')

    primeAudio() // the tap on ✓ that starts the rest
    signalRestOver()
    // Ambient audio mixes with other apps' audio; "playback" would pause it.
    expect(types).toEqual(['ambient'])
    expect(contexts).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(contexts[0].closed).toBe(true)
    // The next rest gets a new one.
    primeAudio()
    expect(contexts).toHaveLength(2)
  })
})
