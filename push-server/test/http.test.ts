import { describe, expect, it } from 'vitest'
import {
  applyTimerRequest,
  applyWeeklyRequest,
  corsHeaders,
  MAX_LATE,
  MAX_REMINDERS,
  MAX_TIMERS,
  nextAlarm,
  nextWeekly,
  parseTestRequest,
  parseTimerRequest,
  parseWeeklyRequest,
  takeDue,
  takeDueReminders,
  takeDueTests,
  type WeeklyReminders,
} from '../src/http'

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

describe('weekly reminder', () => {
  const keys = { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' }
  const monday = { day: 1, minutes: 15 * 60, timeZone: 'Europe/Madrid' }
  const hour = 3600_000

  it('reads the day, time and time zone, with the keys to encrypt it', () => {
    expect(parseWeeklyRequest(body({ endpoint: apple, keys, weekly: monday }))).toEqual({ endpoint: apple, reminder: { time: monday, keys } })
    expect(parseWeeklyRequest(body({ endpoint: apple, weekly: null }))).toEqual({ endpoint: apple, reminder: null })
  })

  it('refuses a wrong push service, keys, day, time or time zone', () => {
    const bad = (o: object) => parseWeeklyRequest(body({ endpoint: apple, keys, weekly: monday, ...o }))
    expect(bad({ endpoint: 'https://example.com/hook' })).toBeNull()
    expect(bad({ keys: undefined })).toBeNull()
    expect(bad({ keys: { ...keys, p256dh: keys.p256dh.slice(1) } })).toBeNull()
    expect(bad({ keys: { ...keys, auth: 'not a key!' } })).toBeNull()
    expect(bad({ weekly: { ...monday, day: 7 } })).toBeNull()
    expect(bad({ weekly: { ...monday, day: 1.5 } })).toBeNull()
    expect(bad({ weekly: { ...monday, minutes: 24 * 60 } })).toBeNull()
    expect(bad({ weekly: { ...monday, timeZone: 'Europe/Nowhere' } })).toBeNull()
    expect(parseWeeklyRequest('[]')).toBeNull()
  })

  it('rings next Monday at 15:00 in Madrid, also when summer time starts or ends', () => {
    // Thursday 12 November 2026 at 14:00 in Madrid (UTC+1): Monday the 16th at 15:00 = 14:00 UTC.
    expect(nextWeekly(Date.UTC(2026, 10, 12, 13), monday)).toBe(Date.UTC(2026, 10, 16, 14))
    // On Monday before 15:00 it is that day; at 15:00 or later, the next Monday.
    expect(nextWeekly(Date.UTC(2026, 10, 16, 9), monday)).toBe(Date.UTC(2026, 10, 16, 14))
    expect(nextWeekly(Date.UTC(2026, 10, 16, 14), monday)).toBe(Date.UTC(2026, 10, 23, 14))
    // Summer time starts on Sunday 28 March 2027: from 15:00 (UTC+1) to 15:00 (UTC+2), 167 hours later.
    expect(nextWeekly(Date.UTC(2027, 2, 22, 14), monday)).toBe(Date.UTC(2027, 2, 29, 13))
    // It ends on Sunday 25 October 2026: 169 hours.
    expect(nextWeekly(Date.UTC(2026, 9, 19, 13), monday)).toBe(Date.UTC(2026, 9, 26, 14))
    // Any day, time and time zone: Sunday at 9:30 in New York (UTC-5 in November).
    expect(nextWeekly(Date.UTC(2026, 10, 12, 13), { day: 0, minutes: 9 * 60 + 30, timeZone: 'America/New_York' })).toBe(
      Date.UTC(2026, 10, 15, 14, 30),
    )
  })

  it('sends it when due and moves it on to the next week', () => {
    const now = Date.UTC(2026, 10, 12, 13)
    let reminders: WeeklyReminders = applyWeeklyRequest({}, { endpoint: 'a', reminder: { time: monday, keys } }, now)!
    expect(reminders.a).toEqual({ ...monday, keys, next: Date.UTC(2026, 10, 16, 14) })
    const timers = { b: Date.UTC(2026, 10, 12, 14) }
    expect(nextAlarm(timers, reminders)).toBe(timers.b)
    expect(nextAlarm({}, reminders)).toBe(Date.UTC(2026, 10, 16, 14))

    expect(takeDueReminders(reminders, Date.UTC(2026, 10, 16, 13, 59))).toEqual({ due: [], next: reminders })
    const { due, next } = takeDueReminders(reminders, Date.UTC(2026, 10, 16, 14) - 200)
    expect(due).toEqual([['a', reminders.a]])
    expect(next.a.next).toBe(Date.UTC(2026, 10, 23, 14))

    // Hours late (the server was down): not sent, only moved on.
    reminders = next
    const late = takeDueReminders(reminders, Date.UTC(2026, 10, 23, 14) + MAX_LATE + hour)
    expect(late.due).toEqual([])
    expect(late.next.a.next).toBe(Date.UTC(2026, 10, 30, 14))

    expect(applyWeeklyRequest(reminders, { endpoint: 'a', reminder: null }, now)).toEqual({})
  })

  it('refuses more phones than one person has', () => {
    const r = { ...monday, keys, next: 1 }
    const full = Object.fromEntries(Array.from({ length: MAX_REMINDERS }, (_, i) => [`e${i}`, r]))
    expect(applyWeeklyRequest(full, { endpoint: 'new', reminder: { time: monday, keys } }, 0)).toBeNull()
    expect(applyWeeklyRequest(full, { endpoint: 'e1', reminder: { time: monday, keys } }, 0)).not.toBeNull()
  })

  it('sends a test once, a few seconds after asking', () => {
    expect(parseTestRequest(body({ endpoint: apple, keys }))).toEqual({ endpoint: apple, keys })
    expect(parseTestRequest(body({ endpoint: apple }))).toBeNull()
    expect(parseTestRequest(body({ endpoint: 'https://example.com/x', keys }))).toBeNull()
    const tests = { a: { keys, at: 10_000 } }
    expect(nextAlarm({}, {}, tests)).toBe(10_000)
    expect(takeDueTests(tests, 9_000)).toEqual({ due: [], rest: tests })
    expect(takeDueTests(tests, 9_600)).toEqual({ due: [['a', keys]], rest: {} })
  })
})

