/**
 * Push server for the rest timer (Cloudflare Worker, free plan).
 *
 * An app on a locked iPhone is frozen and can't ring when the rest is over, so when a rest starts
 * the app tells this server when it ends, and at that moment the server asks Apple's push service
 * to wake the app, which shows a notification (sound and vibration as set for notifications).
 *
 * It also sends a weekly reminder to choose which exercises to film that week (on Monday at 15:00
 * by default), with a short encrypted message so the app can tell it from the end of a rest.
 *
 * - GET  /key     the VAPID public key the app subscribes with (made on first use, kept here)
 * - POST /timer   `{ endpoint, endsAt, now }` sets the rest of that phone; `endsAt: null` cancels it
 * - POST /weekly  `{ endpoint, keys, weekly: { day, minutes, timeZone } }` sets the weekly reminder
 *                 of that phone (`keys` from its push subscription); `weekly: null` cancels it.
 *                 Answers `{ next }`, when it rings next.
 * - POST /weekly/test  `{ endpoint, keys }` sends that phone the reminder once, 10 seconds later.
 *
 * Everything lives in one Durable Object: the keys and, for each phone, when its rest ends and
 * when its reminder rings. Its alarm rings at the earliest of them. It stores no workout data:
 * only the push endpoint (an opaque URL of the push service), its keys and times.
 */
import {
  applyTimerRequest,
  applyWeeklyRequest,
  corsHeaders,
  MAX_REMINDERS,
  nextAlarm,
  parseTimerRequest,
  parseTestRequest,
  parseWeeklyRequest,
  takeDue,
  takeDueReminders,
  takeDueTests,
  TEST_DELAY,
  type TestReminders,
  type Timers,
  type WeeklyReminders,
} from './http'
import { generateVapidKeys, messageRequest, pushRequest, type SubscriptionKeys, type VapidKeys } from './webpush'

/** The message of the weekly reminder: the app's service worker shows it (public/push-sw.js). */
const REMINDER = JSON.stringify({ type: 'grabar' })

interface Env {
  ALARMS: DurableObjectNamespace
  /** Comma-separated origins of the app (CORS). */
  ALLOWED_ORIGINS: string
  /** Contact for the push services (https: or mailto: URL). */
  VAPID_SUBJECT: string
  /** Comma-separated hosts accepted as push services besides the real ones (local tests only). */
  EXTRA_PUSH_HOSTS?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request.headers.get('Origin'), env.ALLOWED_ORIGINS)
    if (!cors) return new Response('Origen no permitido', { status: 403 })
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    const stub = env.ALARMS.get(env.ALARMS.idFromName('descansos'))
    const response = await stub.fetch(request)
    const headers = new Headers(response.headers)
    for (const [k, v] of Object.entries(cors)) headers.set(k, v)
    return new Response(response.body, { status: response.status, headers })
  },
}

export class RestAlarms {
  private readonly state: DurableObjectState
  private readonly env: Env
  private keysReady?: Promise<VapidKeys>

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (request.method === 'GET' && pathname === '/key') {
      const { publicKey } = await this.keys()
      return Response.json({ publicKey }, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (request.method === 'POST' && pathname === '/timer') {
      const req = parseTimerRequest(await request.text(), this.extraHosts())
      if (!req) return new Response('Petición no válida', { status: 400 })
      const timers = applyTimerRequest(await this.timers(), req, Date.now())
      if (!timers) return new Response('Demasiados descansos a la vez', { status: 429 })
      await this.save({ timers })
      return new Response(null, { status: 204 })
    }
    if (request.method === 'POST' && pathname === '/weekly') {
      const req = parseWeeklyRequest(await request.text(), this.extraHosts())
      if (!req) return new Response('Petición no válida', { status: 400 })
      const reminders = applyWeeklyRequest(await this.reminders(), req, Date.now())
      if (!reminders) return new Response('Demasiados avisos semanales', { status: 429 })
      await this.save({ reminders })
      return Response.json({ next: reminders[req.endpoint]?.next ?? null }, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (request.method === 'POST' && pathname === '/weekly/test') {
      const req = parseTestRequest(await request.text(), this.extraHosts())
      if (!req) return new Response('Petición no válida', { status: 400 })
      const tests = { ...(await this.tests()), [req.endpoint]: { keys: req.keys, at: Date.now() + TEST_DELAY } }
      if (Object.keys(tests).length > MAX_REMINDERS) return new Response('Demasiadas pruebas a la vez', { status: 429 })
      await this.save({ tests })
      return new Response(null, { status: 204 })
    }
    if (request.method === 'GET' && pathname === '/') return new Response('Servidor de avisos de Strong 2.0')
    return new Response('No encontrado', { status: 404 })
  }

  /** A rest is over or a weekly reminder is due: wake each of those phones. */
  async alarm(): Promise<void> {
    const now = Date.now()
    const { due, rest } = takeDue(await this.timers(), now)
    const { due: reminders, next } = takeDueReminders(await this.reminders(), now)
    const { due: tests, rest: testsLeft } = takeDueTests(await this.tests(), now)
    // Saved before sending, so a rest started while the pushes go out is kept.
    await this.save({ timers: rest, reminders: next, tests: testsLeft })
    if (!due.length && !reminders.length && !tests.length) return
    const keys = await this.keys()
    const [, gone] = await Promise.all([
      Promise.all(due.map((endpoint) => this.push(endpoint, keys))),
      Promise.all(reminders.map(([endpoint, r]) => this.push(endpoint, keys, r.keys))),
      Promise.all(tests.map(([endpoint, to]) => this.push(endpoint, keys, to))),
    ])
    // Phones that are no longer subscribed (the app was removed): forget their reminders.
    const forget = reminders.filter((_, i) => gone[i]).map(([endpoint]) => endpoint)
    if (forget.length) {
      const current = await this.reminders()
      for (const endpoint of forget) delete current[endpoint]
      await this.save({ reminders: current })
    }
  }

  /**
   * Wakes a phone: without a message for the end of a rest, with the reminder (encrypted with the
   * phone's keys) otherwise. True if the push service says the phone is no longer subscribed.
   */
  private async push(endpoint: string, keys: VapidKeys, to?: SubscriptionKeys): Promise<boolean> {
    try {
      const subject = this.env.VAPID_SUBJECT
      const init = to ? await messageRequest(endpoint, keys, subject, REMINDER, to) : await pushRequest(endpoint, keys, subject)
      const res = await fetch(endpoint, init)
      if (!res.ok) console.log(`push ${res.status}: ${(await res.text()).slice(0, 200)}`)
      return res.status === 404 || res.status === 410
    } catch (e) {
      console.log(`push failed: ${String(e)}`)
      return false
    }
  }

  private extraHosts(): string[] {
    return (this.env.EXTRA_PUSH_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean)
  }

  private async timers(): Promise<Timers> {
    return (await this.state.storage.get<Timers>('timers')) ?? {}
  }

  private async reminders(): Promise<WeeklyReminders> {
    return (await this.state.storage.get<WeeklyReminders>('weekly')) ?? {}
  }

  private async tests(): Promise<TestReminders> {
    return (await this.state.storage.get<TestReminders>('tests')) ?? {}
  }

  /** Saves what changed and sets the alarm for the first rest to end or reminder due. */
  private async save(changes: { timers?: Timers; reminders?: WeeklyReminders; tests?: TestReminders }): Promise<void> {
    if (changes.timers) await this.state.storage.put('timers', changes.timers)
    if (changes.reminders) await this.state.storage.put('weekly', changes.reminders)
    if (changes.tests) await this.state.storage.put('tests', changes.tests)
    const at = nextAlarm(
      changes.timers ?? (await this.timers()),
      changes.reminders ?? (await this.reminders()),
      changes.tests ?? (await this.tests()),
    )
    if (at === null) await this.state.storage.deleteAlarm()
    else await this.state.storage.setAlarm(at)
  }

  /** The VAPID keys, made the first time. One promise, so two first requests can't make two pairs. */
  private keys(): Promise<VapidKeys> {
    this.keysReady ??= this.loadKeys().catch((e: unknown) => {
      this.keysReady = undefined
      throw e
    })
    return this.keysReady
  }

  private async loadKeys(): Promise<VapidKeys> {
    const saved = await this.state.storage.get<VapidKeys>('vapid')
    if (saved) return saved
    const keys = await generateVapidKeys()
    await this.state.storage.put('vapid', keys)
    return keys
  }
}
