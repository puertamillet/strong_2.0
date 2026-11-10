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

/**
 * Reads a timer request: `{ endpoint, endsAt, now }`, with the end and the current time as the
 * phone's clock tells them, so a phone whose clock is off still gets the alarm on time. Returns
 * null if anything is wrong. `extraHosts` lets a local test server stand in for a push service.
 */
export function parseTimerRequest(text: string, extraHosts: string[] = []): TimerRequest | null {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null) return null
  const { endpoint, endsAt, now } = body as Record<string, unknown>
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return null
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return null
  }
  const known = url.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(url.hostname))
  if (!known && !extraHosts.includes(url.hostname)) return null
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

/** When the next alarm should ring, or null if no rest is pending. */
export function nextAlarm(timers: Timers): number | null {
  const times = Object.values(timers)
  return times.length ? Math.min(...times) : null
}
