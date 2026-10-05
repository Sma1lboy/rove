/**
 * Cloudflare Access in front of the bridge: the edge authenticates the phone
 * (service token or SSO) and forwards a signed `Cf-Access-Jwt-Assertion`.
 * The bridge re-checks it — signature against the team's published keys,
 * issuer, audience, expiry — so a request that reached the tunnel origin some
 * other way (or a forged header) is refused. The token check still runs after.
 */

import { type KeyObject, createPublicKey, verify } from "node:crypto"
import type { CloudflareAccess } from "./cli-args.ts"

export class AccessDenied extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = "AccessDenied"
  }
}

interface Jwk extends JsonWebKey {
  readonly kid?: string
}

export type FetchJwks = (url: string) => Promise<{ keys: readonly Jwk[] }>

const fetchJwksOverHttps: FetchJwks = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`)
  const body: unknown = await res.json()
  if (!body || typeof body !== "object" || !("keys" in body) || !Array.isArray(body.keys)) {
    throw new Error(`${url} did not return a JWKS`)
  }
  return { keys: body.keys }
}

/** Unknown-kid refetches are rate limited so junk tokens cannot hammer Cloudflare. */
const REFETCH_MIN_MS = 60_000
/** Clock skew tolerated on `exp`/`nbf`/`iat`. */
const LEEWAY_S = 30

function decodeSegment(segment: string, what: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"))
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  } catch {
    // fall through to the typed refusal
  }
  throw new AccessDenied(`malformed JWT ${what}`)
}

export interface AccessVerifier {
  /** Resolves on a valid assertion; rejects with {@link AccessDenied} otherwise. */
  verify(assertion: string | null | undefined): Promise<void>
}

export function createAccessVerifier(
  access: CloudflareAccess,
  deps: { fetchJwks?: FetchJwks; now?: () => number } = {},
): AccessVerifier {
  const fetchJwks = deps.fetchJwks ?? fetchJwksOverHttps
  const now = deps.now ?? Date.now
  const certsUrl = `${access.teamDomain}/cdn-cgi/access/certs`
  let keys = new Map<string, KeyObject>()
  let fetchedAt = Number.NEGATIVE_INFINITY

  const refresh = async (): Promise<void> => {
    fetchedAt = now()
    const jwks = await fetchJwks(certsUrl)
    const next = new Map<string, KeyObject>()
    for (const jwk of jwks.keys) {
      if (jwk.kty !== "RSA" || !jwk.kid) continue
      next.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" }))
    }
    keys = next
  }

  const keyFor = async (kid: string): Promise<KeyObject> => {
    let key = keys.get(kid)
    if (!key && now() - fetchedAt >= REFETCH_MIN_MS) {
      await refresh()
      key = keys.get(kid)
    }
    if (!key) throw new AccessDenied(`no signing key ${kid} at ${certsUrl}`)
    return key
  }

  return {
    async verify(assertion) {
      if (!assertion) throw new AccessDenied("missing Cf-Access-Jwt-Assertion header")
      const parts = assertion.split(".")
      if (parts.length !== 3) throw new AccessDenied("malformed JWT")
      const [h, p, s] = parts as [string, string, string]
      const header = decodeSegment(h, "header")
      if (header.alg !== "RS256") throw new AccessDenied(`unexpected JWT alg ${String(header.alg)}`)
      if (typeof header.kid !== "string") throw new AccessDenied("JWT has no kid")
      const key = await keyFor(header.kid)
      if (!verify("RSA-SHA256", Buffer.from(`${h}.${p}`), key, Buffer.from(s, "base64url"))) {
        throw new AccessDenied("bad JWT signature")
      }
      const claims = decodeSegment(p, "payload")
      if (claims.iss !== access.teamDomain)
        throw new AccessDenied(`JWT issuer ${String(claims.iss)} is not ${access.teamDomain}`)
      const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
      if (!aud.includes(access.aud)) throw new AccessDenied("JWT audience does not match this Access application")
      const nowS = now() / 1000
      if (typeof claims.exp !== "number" || claims.exp + LEEWAY_S < nowS) throw new AccessDenied("JWT expired")
      if (typeof claims.nbf === "number" && claims.nbf - LEEWAY_S > nowS) throw new AccessDenied("JWT not yet valid")
    },
  }
}
