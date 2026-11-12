import { fromBase64url, type SubscriptionKeys } from './webpush'

/** What the app sends: when the rest of this phone ends, or null to cancel it. */
export interface TimerRequest {
  /** The phone's push subscription endpoint (an opaque URL of its push service). */
  endpoint: string
  /** Milliseconds from now until the rest ends; null cancels it. */
  delay: number | null
}

/** Push services of the browsers that can install the app: the server only ever calls these. */
const PUSH_HOSTS = [/(^|\.)push\.apple\.com$/, /^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/]

/** The longest rest the server waits for. */
export const MAX_DELAY = 3 * 60 * 60 * 1000

/** The JSON object of a request, or null. */
function parseObject(text: string): Record<string, unknown> | null {
  try {
    const body: unknown = JSON.parse(text)
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * A phone's push address: a URL of a known push service. `extraHosts` lets a local test server
 * stand in for one.
 */
function isEndpoint(endpoint: unknown, extraHosts: string[]): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return false
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  const known = url.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(url.hostname))
  return known || extraHosts.includes(url.hostname)
}

/**
 * Reads a timer request: `{ endpoint, endsAt, now }`, with the end and the current time as the
 * phone's clock tells them, so a phone whose clock is off still gets the alarm on time. Returns
 * null if anything is wrong. `extraHosts` lets a local test server stand in for a push service.
 */
export function parseTimerRequest(text: string, extraHosts: string[] = []): TimerRequest | null {
  const body = parseObject(text)
  if (!body) return null
  const { endpoint, endsAt, now } = body
  if (!isEndpoint(endpoint, extraHosts)) return null
  if (endsAt === null) return { endpoint, delay: null }
  if (typeof endsAt !== 'number' || typeof now !== 'number' || !Number.isFinite(endsAt - now)) return null
  const delay = Math.max(0, endsAt - now)
  return delay > MAX_DELAY ? null : { endpoint, delay }
}

/**
 * CORS headers for a request from `origin`: only the app's own origins may use the server from a
 * browser. Null if the origin is not allowed; no headers if there is no origin (not a web page).
 */
export function corsHeaders(origin: string | null, allowed: string): Record<string, string> | null {
  if (!origin) return {}
  const origins = allowed.split(',').map((o) => o.trim())
  if (!origins.includes(origin)) return null
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

/** The pending rests by endpoint, as the time each one ends (ms since 1970, server clock). */
export type Timers = Record<string, number>

/** At most this many phones waiting at once: the server is for one person's devices. */
export const MAX_TIMERS = 20

/** The timers after a request, or null if there would be too many. */
export function applyTimerRequest(timers: Timers, req: TimerRequest, now: number): Timers | null {
  const next = { ...timers }
  if (req.delay === null) {
    delete next[req.endpoint]
    return next
  }
  next[req.endpoint] = now + req.delay
  return Object.keys(next).length > MAX_TIMERS ? null : next
}

/** The endpoints due by `now` (with a little slack), and the timers left. */
export function takeDue(timers: Timers, now: number): { due: string[]; rest: Timers } {
  const due: string[] = []
  const rest: Timers = {}
  for (const [endpoint, at] of Object.entries(timers)) {
    if (at <= now + 500) due.push(endpoint)
    else rest[endpoint] = at
  }
  return { due, rest }
}

/** When the next alarm should ring: the first rest to end or reminder due. Null if there is none. */
export function nextAlarm(timers: Timers, reminders: WeeklyReminders = {}, tests: TestReminders = {}): number | null {
  const times = [...Object.values(timers), ...Object.values(reminders).map((r) => r.next), ...Object.values(tests).map((t) => t.at)]
  return times.length ? Math.min(...times) : null
}

/**
 * The weekly reminder to choose what to film that week: a day and time on the phone's clock, in
 * its time zone, so it keeps ringing at that time when summer time starts or ends.
 */
export interface WeeklyTime {
  /** Day of the week, 0 = Sunday … 6 = Saturday. */
  day: number
  /** Minutes after midnight. */
  minutes: number
  /** The phone's time zone, e.g. Europe/Madrid. */
  timeZone: string
}

/** What the app sends to set the reminder of this phone, with the keys to encrypt it, or null to cancel it. */
export interface WeeklyRequest {
  endpoint: string
  reminder: { time: WeeklyTime; keys: SubscriptionKeys } | null
}

export interface WeeklyReminder extends WeeklyTime {
  keys: SubscriptionKeys
  /** When it rings next (ms since 1970). */
  next: number
}

/** The weekly reminders by endpoint. */
export type WeeklyReminders = Record<string, WeeklyReminder>

/** At most this many phones with a weekly reminder. */
export const MAX_REMINDERS = 20

function isKey(text: unknown, bytes: number): text is string {
  if (typeof text !== 'string' || !/^[\w-]+=*$/.test(text) || text.length > 200) return false
  try {
    const raw = fromBase64url(text.replace(/=+$/, ''))
    return raw.length === bytes && (bytes !== 65 || raw[0] === 4)
  } catch {
    return false
  }
}

function isTimeZone(text: unknown): text is string {
  if (typeof text !== 'string' || !text || text.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: text })
    return true
  } catch {
    return false
  }
}

/**
 * Reads a weekly reminder request: `{ endpoint, keys: { p256dh, auth }, weekly: { day, minutes,
 * timeZone } }`, with the keys of the phone's push subscription (a P-256 public key and its
 * secret), or `{ endpoint, weekly: null }` to cancel it. Null if anything is wrong.
 */
export function parseWeeklyRequest(text: string, extraHosts: string[] = []): WeeklyRequest | null {
  const body = parseObject(text)
  if (!body) return null
  const { endpoint, keys, weekly } = body
  if (!isEndpoint(endpoint, extraHosts)) return null
  if (weekly === null) return { endpoint, reminder: null }
  if (typeof keys !== 'object' || keys === null || typeof weekly !== 'object' || weekly === null) return null
  const { p256dh, auth } = keys as Record<string, unknown>
  const { day, minutes, timeZone } = weekly as Record<string, unknown>
  if (!isKey(p256dh, 65) || !isKey(auth, 16) || !isTimeZone(timeZone)) return null
  if (!Number.isInteger(day) || (day as number) < 0 || (day as number) > 6) return null
  if (!Number.isInteger(minutes) || (minutes as number) < 0 || (minutes as number) >= 24 * 60) return null
  return {
    endpoint,
    reminder: { time: { day: day as number, minutes: minutes as number, timeZone }, keys: { p256dh, auth } },
  }
}

/** The date and time the clock shows in `timeZone` at `instant`. */
function clockAt(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') }
}

/** How far the clock in `timeZone` is ahead of UTC at `instant`, in ms (e.g. 2 hours in Madrid in summer). */
function offsetAt(instant: number, timeZone: string): number {
  const c = clockAt(instant, timeZone)
  return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) - Math.floor(instant / 1000) * 1000
}

/** The instant when the clock in `timeZone` shows that date (month from 0) and time. */
function instantOf(year: number, month: number, date: number, minutes: number, timeZone: string): number {
  const asUtc = Date.UTC(year, month, date, 0, minutes)
  const guess = asUtc - offsetAt(asUtc, timeZone)
  // Again with the offset at that moment, in case summer time starts or ends in between.
  return asUtc - offsetAt(guess, timeZone)
}

/** The first time after `after` that the clock in the reminder's time zone shows its day and time. */
export function nextWeekly(after: number, { day, minutes, timeZone }: WeeklyTime): number {
  const today = clockAt(after, timeZone)
  for (let i = 0; i <= 7; i++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + i))
    if (date.getUTCDay() !== day) continue
    const at = instantOf(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), minutes, timeZone)
    if (at > after) return at
  }
  throw new Error('No next reminder')
}

/** The reminders after a request, or null if there would be too many. */
export function applyWeeklyRequest(reminders: WeeklyReminders, req: WeeklyRequest, now: number): WeeklyReminders | null {
  const next = { ...reminders }
  if (!req.reminder) {
    delete next[req.endpoint]
    return next
  }
  const { time, keys } = req.reminder
  next[req.endpoint] = { ...time, keys, next: nextWeekly(now, time) }
  return Object.keys(next).length > MAX_REMINDERS ? null : next
}

/** A reminder this late is not sent (the server was down): it would come at an odd time. */
export const MAX_LATE = 6 * 60 * 60 * 1000

/**
 * The reminders due by `now` (with a little slack) that are still worth sending, and all the
 * reminders with the due ones moved on to the next week.
 */
export function takeDueReminders(reminders: WeeklyReminders, now: number): { due: [string, WeeklyReminder][]; next: WeeklyReminders } {
  const due: [string, WeeklyReminder][] = []
  const next: WeeklyReminders = {}
  for (const [endpoint, r] of Object.entries(reminders)) {
    if (r.next > now + 500) {
      next[endpoint] = r
      continue
    }
    if (now - r.next <= MAX_LATE) due.push([endpoint, r])
    next[endpoint] = { ...r, next: nextWeekly(Math.max(now, r.next), r) }
  }
  return { due, next }
}

/** Reminders sent once, a few seconds after asking, to try the reminder without waiting for Monday. */
export type TestReminders = Record<string, { keys: SubscriptionKeys; at: number }>

export const TEST_DELAY = 10_000

/** Reads a request to try the reminder: `{ endpoint, keys }`. Null if anything is wrong. */
export function parseTestRequest(text: string, extraHosts: string[] = []): { endpoint: string; keys: SubscriptionKeys } | null {
  const body = parseObject(text)
  if (!body) return null
  const { endpoint, keys } = body
  if (!isEndpoint(endpoint, extraHosts) || typeof keys !== 'object' || keys === null) return null
  const { p256dh, auth } = keys as Record<string, unknown>
  return isKey(p256dh, 65) && isKey(auth, 16) ? { endpoint, keys: { p256dh, auth } } : null
}

/** The test reminders due by `now`, and the ones left. */
export function takeDueTests(tests: TestReminders, now: number): { due: [string, SubscriptionKeys][]; rest: TestReminders } {
  const due: [string, SubscriptionKeys][] = []
  const rest: TestReminders = {}
  for (const [endpoint, t] of Object.entries(tests)) {
    if (t.at <= now + 500) due.push([endpoint, t.keys])
    else rest[endpoint] = t
  }
  return { due, rest }
}
