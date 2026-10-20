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

/** The protocol a browser offers alongside its token, and the one the upgrade echoes back. */
export const WEB_SUBPROTOCOL = "rove.v1"
const TOKEN_SUBPROTOCOL_PREFIX = "rove.bearer."

/**
 * The token a WebSocket upgrade presents. Phones send `Authorization: Bearer`;
 * a browser cannot set that header, so it offers `rove.bearer.<token>` as a
 * `Sec-WebSocket-Protocol` instead. Never the query string: a URL token lands
 * in proxy and tunnel access logs, so only the pairing QR carries one.
 */
export function presentedToken(req: Request): string | null {
  const header = req.headers.get("authorization")
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length).trim()
  for (const offered of (req.headers.get("sec-websocket-protocol") ?? "").split(",")) {
    const name = offered.trim()
    if (name.startsWith(TOKEN_SUBPROTOCOL_PREFIX)) return name.slice(TOKEN_SUBPROTOCOL_PREFIX.length)
  }
  return null
}

/** True when the upgrade came from the browser client, which must get its protocol echoed. */
export function offersWebSubprotocol(req: Request): boolean {
  return (req.headers.get("sec-websocket-protocol") ?? "").split(",").some((p) => p.trim() === WEB_SUBPROTOCOL)
}

/**
 * The link `rove --web` prints. The token rides in the fragment, which the
 * browser never sends: it reaches no server or proxy log. The page moves it
 * into storage and strips it from the address bar before anything else runs.
 */
export function webUrl(opts: { host: string; port: number; token: string; tls: boolean }): string {
  const shown = opts.host.includes(":") ? `[${opts.host}]` : opts.host
  const origin = opts.tls ? `https://${shown}` : `http://${shown}:${opts.port}`
  return `${origin}/#token=${opts.token}`
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
