import { describe, expect, it } from 'vitest'
import { base64url, fromBase64url, generateVapidKeys, pushRequest, vapidAuthorization } from '../src/webpush'

const endpoint = 'https://web.push.apple.com/QGuQyavXutnMH1aGaE5dQvJhD0Fsh0TnFvM9jSZkXPd'
const subject = 'https://puertamillet.github.io/strong_2.0/'

function decodeJson(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(fromBase64url(part)))
}

describe('web push', () => {
  it('encodes base64url both ways', () => {
    const bytes = new Uint8Array([0, 251, 255, 62, 63, 1, 2])
    expect(base64url(bytes)).toBe('APv_Pj8BAg')
    expect([...fromBase64url('APv_Pj8BAg')]).toEqual([...bytes])
  })

  it('makes P-256 keys the app can subscribe with', async () => {
    const keys = await generateVapidKeys()
    const raw = fromBase64url(keys.publicKey)
    expect(raw).toHaveLength(65)
    expect(raw[0]).toBe(4) // uncompressed point
    expect(keys.privateKey).toMatchObject({ kty: 'EC', crv: 'P-256' })
    expect(keys.privateKey.d).toBeTruthy()
  })

  it('signs a VAPID token for the push service that checks with the public key', async () => {
    const keys = await generateVapidKeys()
    const now = Date.UTC(2026, 10, 10, 20, 0, 0)
    const auth = await vapidAuthorization(endpoint, keys, subject, now)
    const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(auth)
    expect(match).not.toBeNull()
    const [, header, claims, signature, k] = match!
    expect(k).toBe(keys.publicKey)
    expect(decodeJson(header)).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(decodeJson(claims)).toEqual({ aud: 'https://web.push.apple.com', exp: now / 1000 + 3600, sub: subject })

    const publicKey = await crypto.subtle.importKey('raw', fromBase64url(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'verify',
    ])
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      fromBase64url(signature),
      new TextEncoder().encode(`${header}.${claims}`),
    )
    expect(ok).toBe(true)
  })

  it('asks for an urgent push without payload that expires in a minute', async () => {
    const keys = await generateVapidKeys()
    const init = await pushRequest(endpoint, keys, subject)
    expect(init.method).toBe('POST')
    expect(init.body).toBe('')
    expect(init.headers).toMatchObject({ TTL: '60', Urgency: 'high' })
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^vapid t=/)
  })
})
