/**
 * Web Push from the bridge with no dependency: RFC 8291 message encryption (aes128gcm, one record) and
 * RFC 8292 VAPID (an ES256 JWT the push service checks against the key the browser subscribed with).
 * The push service only relays ciphertext; it never sees the payload.
 */

import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from "node:crypto"

export interface PushKeys {
  /** The subscriber's P-256 public key, uncompressed, base64url (`PushSubscription.keys.p256dh`). */
  readonly p256dh: string
  /** 16 random bytes, base64url (`PushSubscription.keys.auth`). */
  readonly auth: string
}

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url: the page's `applicationServerKey`. */
  readonly publicKey: string
  readonly privateKey: string
}

const RECORD_SIZE = 4096
/** Apple requires a `sub`; a contact URL, never the owner's address. */
const VAPID_SUBJECT = "https://rove.run"
const JWT_LIFETIME_S = 12 * 60 * 60

export const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url")
export const fromB64url = (text: string): Buffer => Buffer.from(text, "base64url")

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH("prime256v1")
  ecdh.generateKeys()
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) }
}

const hkdf = (ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Buffer =>
  Buffer.from(hkdfSync("sha256", ikm, salt, info, length))

/**
 * The request body for one push. `salt` and `serverPrivateKey` are fresh per message; tests pin them to
 * reproduce RFC 8291 Appendix A.
 */
export function encryptPayload(
  plaintext: Uint8Array,
  keys: PushKeys,
  fixed: { salt?: Uint8Array; serverPrivateKey?: Uint8Array } = {},
): Buffer {
  const uaPublic = fromB64url(keys.p256dh)
  const authSecret = fromB64url(keys.auth)
  const server = createECDH("prime256v1")
  if (fixed.serverPrivateKey) server.setPrivateKey(Buffer.from(fixed.serverPrivateKey))
  else server.generateKeys()
  const asPublic = server.getPublicKey()
  const ecdhSecret = server.computeSecret(uaPublic)
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic])
  const ikm = hkdf(ecdhSecret, authSecret, keyInfo, 32)
  const salt = Buffer.from(fixed.salt ?? randomBytes(16))
  const cek = hkdf(ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16)
  const nonce = hkdf(ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12)
  const cipher = createCipheriv("aes-128-gcm", cek, nonce)
  // 0x02: the last (only) record's padding delimiter.
  const sealed = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final()])
  const header = Buffer.alloc(21)
  salt.copy(header, 0)
  header.writeUInt32BE(RECORD_SIZE, 16)
  header.writeUInt8(asPublic.length, 20)
  return Buffer.concat([header, asPublic, sealed, cipher.getAuthTag()])
}

/** `Authorization: vapid t=<ES256 JWT>, k=<public key>` for one push service origin. */
export function vapidAuthorization(endpoint: string, vapid: VapidKeys, nowMs = Date.now()): string {
  const pub = fromB64url(vapid.publicKey)
  const key = createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      d: vapid.privateKey,
      x: b64url(pub.subarray(1, 33)),
      y: b64url(pub.subarray(33, 65)),
    },
  })
  const part = (value: object) => b64url(Buffer.from(JSON.stringify(value)))
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + JWT_LIFETIME_S, sub: VAPID_SUBJECT }
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part(claims)}`
  const signature = sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" })
  return `vapid t=${unsigned}.${b64url(signature)}, k=${vapid.publicKey}`
}

/**
 * The push services browsers subscribe with. The page hands the bridge an endpoint it will POST to, so
 * anything else (a LAN address, the daemon's own port) is refused.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /(^|\.)push\.apple\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
]

export function isPushEndpoint(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  return (
    url.protocol === "https:" && url.port === "" && !url.username && PUSH_HOSTS.some((host) => host.test(url.hostname))
  )
}

export interface PushTarget extends PushKeys {
  readonly endpoint: string
}

/** POSTs one encrypted message; the status tells the caller whether the subscription is gone (404/410). */
export async function sendPush(
  target: PushTarget,
  payload: unknown,
  vapid: VapidKeys,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const body = encryptPayload(Buffer.from(JSON.stringify(payload)), target)
  const res = await fetchImpl(target.endpoint, {
    method: "POST",
    headers: {
      Authorization: vapidAuthorization(target.endpoint, vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(24 * 60 * 60),
      Urgency: "high",
    },
    body,
    signal: AbortSignal.timeout(10_000),
  })
  return res.status
}
