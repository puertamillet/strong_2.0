import { describe, expect, it } from 'vitest'
import { base64url, encryptMessage, fromBase64url, generateVapidKeys, messageRequest, pushRequest, vapidAuthorization } from '../src/webpush'

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

  it('encrypts a message for the phone as in the example of RFC 8291', async () => {
    const serverPublic = fromBase64url('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8')
    const jwk = {
      kty: 'EC',
      crv: 'P-256',
      d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
      x: base64url(serverPublic.slice(1, 33)),
      y: base64url(serverPublic.slice(33)),
    }
    const serverKeys = {
      privateKey: await crypto.subtle.importKey('jwk', jwk, ECDH, true, ['deriveBits']),
      publicKey: await crypto.subtle.importKey('raw', serverPublic, ECDH, true, []),
    }
    const body = await encryptMessage('When I grow up, I want to be a watermelon', exampleKeys, {
      serverKeys,
      salt: fromBase64url('DGv6ra1nlYgDCS1FRnbzlw'),
    })
    expect(base64url(body)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    )
  })

  it('sends the weekly reminder encrypted, so that only the phone can read it', async () => {
    // A phone: its subscription keys, and the private key its browser keeps.
    const phone = (await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair
    const auth = crypto.getRandomValues(new Uint8Array(16))
    const to = { p256dh: base64url(new Uint8Array((await crypto.subtle.exportKey('raw', phone.publicKey)) as ArrayBuffer)), auth: base64url(auth) }
    const init = await messageRequest(endpoint, await generateVapidKeys(), subject, '{"type":"grabar"}', to)
    expect(init.headers).toMatchObject({ TTL: '43200', Urgency: 'normal', 'Content-Encoding': 'aes128gcm' })
    expect(await decrypt(init.body as Uint8Array<ArrayBuffer>, phone.privateKey, to)).toBe('{"type":"grabar"}')
    // A new key pair and salt each time: the same text never looks the same.
    const again = await messageRequest(endpoint, await generateVapidKeys(), subject, '{"type":"grabar"}', to)
    expect(base64url(again.body as Uint8Array)).not.toBe(base64url(init.body as Uint8Array))
  })
})

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const

/** The phone's keys in the example of RFC 8291. */
const exampleKeys = { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' }

/** What the phone's browser does with a message (RFC 8291 and RFC 8188), written apart from the server's code. */
async function decrypt(body: Uint8Array<ArrayBuffer>, phonePrivate: CryptoKey, to: { p256dh: string; auth: string }): Promise<string> {
  const salt = body.slice(0, 16)
  const recordSize = new DataView(body.buffer, body.byteOffset).getUint32(16)
  const serverKey = body.slice(21, 21 + body[20])
  const encrypted = body.slice(21 + body[20])
  expect(recordSize).toBeGreaterThanOrEqual(encrypted.length)
  const server = await crypto.subtle.importKey('raw', serverKey, ECDH, true, [])
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: server }, phonePrivate, 256)
  const hmac = async (key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>) =>
    new Uint8Array(
      await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), data),
    )
  const bytes = (...parts: (Uint8Array | string | number[])[]) =>
    new Uint8Array(parts.flatMap((p) => [...(typeof p === 'string' ? new TextEncoder().encode(p) : p)]))
  // HKDF by hand: extract with HMAC(salt, material), expand one block with HMAC(prk, info | 1).
  const prkKey = await hmac(fromBase64url(to.auth), new Uint8Array(shared))
  const ikm = await hmac(prkKey, bytes('WebPush: info', [0], fromBase64url(to.p256dh), serverKey, [1]))
  const prk = await hmac(salt, ikm)
  const cek = (await hmac(prk, bytes('Content-Encoding: aes128gcm', [0, 1]))).slice(0, 16)
  const nonce = (await hmac(prk, bytes('Content-Encoding: nonce', [0, 1]))).slice(0, 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, encrypted))
  // The last record ends with 2, then padding zeros.
  let end = plain.length - 1
  while (plain[end] === 0) end--
  expect(plain[end]).toBe(2)
  return new TextDecoder().decode(plain.slice(0, end))
}
