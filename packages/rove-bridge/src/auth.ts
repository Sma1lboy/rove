import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
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

/**
 * A browser request's `Origin` is this page: the same host:port the request was sent to, or
 * `https://<publicHost>` when a tunnel serves the page under that name (`--public-host`).
 */
export function browserOriginAllowed(origin: string, host: string | null, publicHost: string | null): boolean {
  try {
    const url = new URL(origin)
    if (host !== null && url.host === host.toLowerCase()) return true
    return publicHost !== null && url.protocol === "https:" && url.host === publicHost.toLowerCase()
  } catch {
    return false
  }
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

/**
 * Per-device credentials: each phone or browser can get its own token, revoked on its own, beside
 * the shared one (`--rotate-token` still revokes everything). Only a SHA-256 of each token is kept,
 * owner-only, so the file cannot be replayed as a credential.
 */
export interface DeviceRecord {
  readonly name: string
  readonly sha256: string
  readonly createdAt: string
}

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex")

export function listDevices(path: string): DeviceRecord[] {
  if (!existsSync(path)) return []
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"))
    return Array.isArray(raw)
      ? raw.filter(
          (d): d is DeviceRecord =>
            !!d && typeof d === "object" && typeof d.name === "string" && /^[0-9a-f]{64}$/.test(d.sha256),
        )
      : []
  } catch {
    return []
  }
}

function writeDevices(path: string, devices: readonly DeviceRecord[]): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(devices, null, 2)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
}

/** Mint a token for `name`, replacing any it had. Returns the token; only its hash is stored. */
export function addDevice(path: string, name: string, now: Date = new Date()): string {
  if (!/^[\w.-]{1,40}$/.test(name)) throw new Error(`device name must be 1-40 letters, digits, . _ or -, got ${name}`)
  const token = randomBytes(32).toString("base64url")
  const rest = listDevices(path).filter((d) => d.name !== name)
  writeDevices(path, [...rest, { name, sha256: hashToken(token), createdAt: now.toISOString() }])
  return token
}

/** Forget `name`'s token; true when there was one. */
export function revokeDevice(path: string, name: string): boolean {
  const devices = listDevices(path)
  const rest = devices.filter((d) => d.name !== name)
  if (rest.length === devices.length) return false
  writeDevices(path, rest)
  return true
}

/** The device a presented token belongs to, or null. Constant-time per record. */
export function deviceOf(path: string, presented: string | null | undefined): string | null {
  if (!presented) return null
  const hash = Buffer.from(hashToken(presented))
  for (const device of listDevices(path)) {
    const stored = Buffer.from(device.sha256)
    if (stored.length === hash.length && timingSafeEqual(stored, hash)) return device.name
  }
  return null
}
