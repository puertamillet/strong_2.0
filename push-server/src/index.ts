/**
 * Push server for the rest timer (Cloudflare Worker, free plan).
 *
 * An app on a locked iPhone is frozen and can't ring when the rest is over, so when a rest starts
 * the app tells this server when it ends, and at that moment the server asks Apple's push service
 * to wake the app, which shows a notification (sound and vibration as set for notifications).
 *
 * - GET  /key    the VAPID public key the app subscribes with (made on first use, kept here)
 * - POST /timer  `{ endpoint, endsAt, now }` sets the rest of that phone; `endsAt: null` cancels it
 *
 * Everything lives in one Durable Object: the keys and, for each phone, when its rest ends. Its
 * alarm rings at the earliest end. It stores no workout data: only the push endpoint (an opaque
 * URL of the push service) and a time.
 */
import { applyTimerRequest, corsHeaders, nextAlarm, parseTimerRequest, takeDue, type Timers } from './http'
import { generateVapidKeys, pushRequest, type VapidKeys } from './webpush'

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
      await this.save(timers)
      return new Response(null, { status: 204 })
    }
    if (request.method === 'GET' && pathname === '/') return new Response('Servidor de avisos de Strong 2.0')
    return new Response('No encontrado', { status: 404 })
  }

  /** A rest is over: wake each phone whose rest ended. */
  async alarm(): Promise<void> {
    const { due, rest } = takeDue(await this.timers(), Date.now())
    // Saved before sending, so a rest started while the pushes go out is kept.
    await this.save(rest)
    if (!due.length) return
    const keys = await this.keys()
    await Promise.all(due.map((endpoint) => this.push(endpoint, keys)))
  }

  private async push(endpoint: string, keys: VapidKeys): Promise<void> {
    try {
      const res = await fetch(endpoint, await pushRequest(endpoint, keys, this.env.VAPID_SUBJECT))
      if (!res.ok) console.log(`push ${res.status}: ${(await res.text()).slice(0, 200)}`)
    } catch (e) {
      console.log(`push failed: ${String(e)}`)
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

  private async save(timers: Timers): Promise<void> {
    await this.state.storage.put('timers', timers)
    const at = nextAlarm(timers)
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
