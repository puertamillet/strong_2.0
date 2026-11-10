/**
 * Web Push without a payload: the notification text is made on the phone (see public/push-sw.js),
 * so the server never sees workout data and the message needs no encryption, only the VAPID
 * signature (RFC 8292) that tells the push service (Apple's, for an iPhone) who sends it.
 */

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url: the app subscribes with it. */
  publicKey: string
  /** The private key, kept in the server's storage. */
  privateKey: JsonWebKey
}

const P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const

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
