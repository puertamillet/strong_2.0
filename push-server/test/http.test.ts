import { describe, expect, it } from 'vitest'
import { applyTimerRequest, corsHeaders, MAX_TIMERS, nextAlarm, parseTimerRequest, takeDue } from '../src/http'

const apple = 'https://web.push.apple.com/QGuQyavXutnMH1aGaE5dQvJhD0Fsh0TnFvM9jSZkXPd'
const body = (o: object) => JSON.stringify(o)

describe('push server requests', () => {
  it('reads when a rest ends, by the phone clock', () => {
    expect(parseTimerRequest(body({ endpoint: apple, endsAt: 1_090_000, now: 1_000_000 }))).toEqual({ endpoint: apple, delay: 90_000 })
    // A rest that already ended rings now.
    expect(parseTimerRequest(body({ endpoint: apple, endsAt: 999_000, now: 1_000_000 }))).toEqual({ endpoint: apple, delay: 0 })
    expect(parseTimerRequest(body({ endpoint: apple, endsAt: null }))).toEqual({ endpoint: apple, delay: null })
  })

  it('refuses anything but a known push service and a sensible time', () => {
    expect(parseTimerRequest('not json')).toBeNull()
    expect(parseTimerRequest(body({ endpoint: 'https://example.com/hook', endsAt: 2, now: 1 }))).toBeNull()
    expect(parseTimerRequest(body({ endpoint: 'http://web.push.apple.com/x', endsAt: 2, now: 1 }))).toBeNull()
    expect(parseTimerRequest(body({ endpoint: 'https://evil.com/web.push.apple.com', endsAt: 2, now: 1 }))).toBeNull()
    expect(parseTimerRequest(body({ endpoint: apple, endsAt: '2', now: 1 }))).toBeNull()
    expect(parseTimerRequest(body({ endpoint: apple, endsAt: 5 * 3600_000, now: 0 }))).toBeNull()
    expect(parseTimerRequest(body({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', endsAt: 2, now: 1 }))?.delay).toBe(1)
    // A local stand-in only when allowed.
    const local = body({ endpoint: 'http://127.0.0.1:9999/push', endsAt: 2, now: 1 })
    expect(parseTimerRequest(local)).toBeNull()
    expect(parseTimerRequest(local, ['127.0.0.1'])?.delay).toBe(1)
  })

  it('only lets the app use it from a browser', () => {
    expect(corsHeaders('https://puertamillet.github.io', 'https://puertamillet.github.io, http://localhost:4174')).toMatchObject({
      'Access-Control-Allow-Origin': 'https://puertamillet.github.io',
    })
    expect(corsHeaders('http://localhost:4174', 'https://puertamillet.github.io, http://localhost:4174')).not.toBeNull()
    expect(corsHeaders('https://example.com', 'https://puertamillet.github.io')).toBeNull()
    expect(corsHeaders(null, 'https://puertamillet.github.io')).toEqual({})
  })

  it('keeps one rest per phone and rings at the earliest', () => {
    let timers = applyTimerRequest({}, { endpoint: 'a', delay: 90_000 }, 1000)!
    timers = applyTimerRequest(timers, { endpoint: 'b', delay: 30_000 }, 1000)!
    timers = applyTimerRequest(timers, { endpoint: 'a', delay: 100_000 }, 1000)!
    expect(timers).toEqual({ a: 101_000, b: 31_000 })
    expect(nextAlarm(timers)).toBe(31_000)
    expect(takeDue(timers, 31_000)).toEqual({ due: ['b'], rest: { a: 101_000 } })
    expect(applyTimerRequest(timers, { endpoint: 'b', delay: null }, 2000)).toEqual({ a: 101_000 })
    expect(nextAlarm({})).toBeNull()
  })

  it('refuses more phones than one person has', () => {
    const full = Object.fromEntries(Array.from({ length: MAX_TIMERS }, (_, i) => [`e${i}`, 1]))
    expect(applyTimerRequest(full, { endpoint: 'new', delay: 1 }, 0)).toBeNull()
    expect(applyTimerRequest(full, { endpoint: 'e1', delay: 5 }, 0)).not.toBeNull()
  })
})
