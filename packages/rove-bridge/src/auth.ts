import { randomBytes, timingSafeEqual } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

/**
 * The persisted pairing token. Minted on first start, reused afterwards so a
 * paired phone survives bridge restarts; `rotate` mints a fresh one, which
 * revokes every paired phone at once. Owner-only file.
 */
export function loadOrCreateToken(path: string, rotate = false): string {
  if (!rotate && existsSync(path)) {
    const saved = readFileSync(path, "utf8").trim()
    if (/^[A-Za-z0-9_-]{43}$/.test(saved)) return saved
  }
  // 32 random bytes, base64url (43 chars).
  const token = randomBytes(32).toString("base64url")
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${token}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
  return token
}

/** Constant-time compare; length mismatch is rejected without leaking where. */
export function tokenMatches(expected: string, presented: string | null | undefined): boolean {
  if (!presented) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(presented)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * The token a WebSocket upgrade presents. Header only: a query-string token
 * lands in proxy and tunnel access logs, so only the pairing QR carries one.
 */
export function presentedToken(req: Request): string | null {
  const header = req.headers.get("authorization")
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null
}

/**
 * The URL the phone scans once; it IS the credential, so treat it like a
 * password. The app reads `token`/`preset` out of it and never dials it as is.
 * TLS endpoints (a tunnel or `tailscale serve`) are reached on the default port.
 */
export function pairingUrl(opts: {
  host: string
  port: number
  token: string
  tls: boolean
  preset: "none" | "tailscale" | "cf"
}): string {
  const shown = opts.host.includes(":") ? `[${opts.host}]` : opts.host
  const origin = opts.tls ? `wss://${shown}` : `ws://${shown}:${opts.port}`
  const preset = opts.preset === "none" ? "" : `&preset=${opts.preset}`
  return `${origin}/?token=${opts.token}${preset}`
}
