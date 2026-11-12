/**
 * Web Push. The end of a rest goes without a payload: the notification text is made on the phone
 * (see public/push-sw.js), so the server never sees workout data and the message needs no
 * encryption, only the VAPID signature (RFC 8292) that tells the push service (Apple's, for an
 * iPhone) who sends it. The weekly reminder carries a short message, encrypted for the phone
 * (RFC 8291) so that its service worker can tell it from a rest.
 */

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url: the app subscribes with it. */
  publicKey: string
  /** The private key, kept in the server's storage. */
  privateKey: JsonWebKey
}

/** The keys of a phone's push subscription (base64url): its P-256 public key and a secret. */
export interface SubscriptionKeys {
  p256dh: string
  auth: string
}

const P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const

export function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function encodeJson(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)))
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey(P256, true, ['sign', 'verify'])) as CryptoKeyPair
  const publicKey = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
  const privateKey = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey
  return { publicKey: base64url(publicKey), privateKey }
}

/**
 * The Authorization header for a push to `endpoint`: a JWT signed with ES256 for the push
 * service's origin, valid for an hour, with `subject` as the contact (an https: or mailto: URL).
 */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): Promise<string> {
  const header = encodeJson({ typ: 'JWT', alg: 'ES256' })
  const claims = encodeJson({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 3600, sub: subject })
  const key = await crypto.subtle.importKey('jwk', keys.privateKey, P256, false, ['sign'])
  const unsigned = `${header}.${claims}`
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned))
  return `vapid t=${unsigned}.${base64url(new Uint8Array(signature))}, k=${keys.publicKey}`
}

/**
 * The request that asks the push service to wake the app now. A late alarm is useless, so it is
 * dropped if the phone can't get it within a minute (TTL), and it is urgent (delivered at once).
 */
export async function pushRequest(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): Promise<RequestInit> {
  return {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(endpoint, keys, subject, now),
      TTL: '60',
      Urgency: 'high',
    },
    body: '',
  }
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** HKDF with SHA-256 (RFC 5869): `bytes` bytes from the key material, the salt and the info. */
async function hkdf(salt: Uint8Array, material: Uint8Array, info: string | Uint8Array, bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', concat(material), 'HKDF', false, ['deriveBits'])
  const infoBytes = typeof info === 'string' ? new TextEncoder().encode(info) : info
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: concat(salt), info: concat(infoBytes) }, key, bytes * 8)
  return new Uint8Array(bits)
}

/** Size of the records of an encrypted message: it fits in one. */
const RECORD_SIZE = 4096

/**
 * Encrypts a message so that only the phone of the subscription can read it (RFC 8291, in one
 * aes128gcm record of RFC 8188). The server's key pair and the salt are new for each message;
 * tests pass their own.
 */
export async function encryptMessage(
  text: string,
  to: SubscriptionKeys,
  { serverKeys, salt = crypto.getRandomValues(new Uint8Array(16)) }: { serverKeys?: CryptoKeyPair; salt?: Uint8Array } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const phoneKey = fromBase64url(to.p256dh)
  const pair = serverKeys ?? ((await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair)
  const serverKey = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
  const phone = await crypto.subtle.importKey('raw', phoneKey, ECDH, true, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: phone }, pair.privateKey, 256))
  const info = concat(new TextEncoder().encode('WebPush: info\0'), phoneKey, serverKey)
  const material = await hkdf(fromBase64url(to.auth), shared, info, 32)
  const cek = await hkdf(salt, material, 'Content-Encoding: aes128gcm\0', 16)
  const nonce = await hkdf(salt, material, 'Content-Encoding: nonce\0', 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  // The text and the delimiter of the last record (2), without padding.
  const record = concat(new TextEncoder().encode(text), new Uint8Array([2]))
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, record))
  // Header: salt, record size, and the server's public key, which the phone needs to decrypt.
  const header = new Uint8Array(21)
  header.set(salt)
  new DataView(header.buffer).setUint32(16, RECORD_SIZE)
  header[20] = serverKey.length
  return concat(header, serverKey, encrypted)
}

/**
 * The request that sends a short message to a phone (the weekly reminder), encrypted for it. It
 * is not urgent, and if the phone is off the push service keeps it for up to 12 hours.
 */
export async function messageRequest(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  text: string,
  to: SubscriptionKeys,
  now = Date.now(),
): Promise<RequestInit> {
  return {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(endpoint, keys, subject, now),
      TTL: String(12 * 60 * 60),
      Urgency: 'normal',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
    },
    body: await encryptMessage(text, to),
  }
}
