/**
 * `POST /login` and `POST /logout` for the browser client. Login is a door in front of the token,
 * not a second kind of credential: a right password mints a fresh device token (`auth.ts`
 * devices), which the page then uses exactly like a `#token=` link. Without a stored password
 * `/login` does not exist and the page behaves as before.
 */

import { addDevice, browserOriginAllowed, deviceOf, listDevices, presentedToken, revokeDevice } from "./auth.ts"
import {
  type Lock,
  MAX_PASSWORD_LENGTH,
  lockOf,
  readLockout,
  readPassword,
  recordFailure,
  recordSuccess,
  verifyPassword,
  webPasswordPaths,
  writeLockout,
} from "./web-password.ts"

export interface WebLoginOptions {
  readonly bridgeDir: string
  readonly devicesPath: string
  /** The tunnel hostname the page is served under, if any (`--public-host`). */
  readonly publicHost: string | null
  /** True when a configured tunnel (cf preset or `--public-host`) puts `CF-Connecting-IP` in front. */
  readonly trustForwardedIp: boolean
  readonly log: (line: string) => void
  readonly now?: () => number
  /** Wait added to every failed attempt; tests pass 0. */
  readonly failureDelayMs?: () => number
}

export interface WebLogin {
  /** A response for `/login` or `/logout`, or null when `req` is neither (or no password is set). */
  handle(req: Request, peer: string): Promise<Response | null>
}

const MAX_BODY_BYTES = 4096
const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  })

/** `web-login-20261022-141503` in UTC; a second login in the same second gets a suffix. */
export function loginDeviceName(devicesPath: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)
  const taken = new Set(listDevices(devicesPath).map((d) => d.name))
  const base = `web-login-${stamp}`
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

export function createWebLogin(opts: WebLoginOptions): WebLogin {
  const paths = webPasswordPaths(opts.bridgeDir)
  const now = opts.now ?? Date.now
  const delay = opts.failureDelayMs ?? (() => 300 + Math.floor(Math.random() * 200))
  // Attempts run one at a time: each reads, checks and rewrites the counter file.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => {})
    return run
  }

  const clientIp = (req: Request, peer: string): string => {
    const forwarded = req.headers.get("cf-connecting-ip")?.trim()
    // Only a loopback peer can be cloudflared; anyone else could forge the header.
    if (opts.trustForwardedIp && forwarded && LOOPBACK.test(peer) && /^[0-9A-Fa-f:.]{2,45}$/.test(forwarded)) {
      return forwarded
    }
    return peer
  }

  /** Same-origin only: no CORS, and a browser on another site is refused even with the right password. */
  const sameOrigin = (req: Request): boolean => {
    const origin = req.headers.get("origin")
    if (origin === null || !browserOriginAllowed(origin, req.headers.get("host"), opts.publicHost)) return false
    const site = req.headers.get("sec-fetch-site")
    return site === null || site === "same-origin"
  }

  const stamp = (): string => new Date(now()).toISOString()

  const lockedResponse = (lock: Lock): Response =>
    lock.kind === "global"
      ? json(429, { error: "locked; unlock on the host", locked: "global" })
      : json(
          429,
          { error: "locked", locked: "ip", retryAfterSeconds: Math.ceil(lock.retryAfterMs / 1000) },
          { "Retry-After": String(Math.ceil(lock.retryAfterMs / 1000)) },
        )

  async function login(req: Request, peer: string): Promise<Response> {
    const ip = clientIp(req, peer)
    if (!sameOrigin(req)) {
      opts.log(`[rove-bridge] ${stamp()} 403 from ${ip}: cross-origin /login from ${req.headers.get("origin")}`)
      return json(403, { error: "forbidden" })
    }
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return json(415, { error: "expected application/json" })
    }
    const body = await req.text()
    if (body.length > MAX_BODY_BYTES) return json(413, { error: "too large" })
    let password: unknown
    try {
      password = (JSON.parse(body) as { password?: unknown })?.password
    } catch {
      password = undefined
    }
    if (typeof password !== "string" || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
      return json(400, { error: "expected {password}" })
    }
    const entered = password
    const outcome = await serial(async () => {
      const record = readPassword(paths.password)
      if (!record) return { kind: "gone" as const }
      const state = readLockout(paths.lockout)
      const held = lockOf(state, ip, now())
      if (held) return { kind: "locked" as const, lock: held }
      if (await verifyPassword(record, entered)) {
        writeLockout(paths.lockout, recordSuccess(state, ip))
        const name = loginDeviceName(opts.devicesPath, new Date(now()))
        return { kind: "ok" as const, name, token: addDevice(opts.devicesPath, name, new Date(now())) }
      }
      const next = recordFailure(state, ip, now())
      writeLockout(paths.lockout, next.state)
      return { kind: "failed" as const, lock: next.lock, count: next.state.failures.length }
    })
    switch (outcome.kind) {
      case "gone":
        return json(404, { error: "not found" })
      case "locked":
        opts.log(`[rove-bridge] ${stamp()} login refused from ${ip}: locked (${outcome.lock.kind})`)
        return lockedResponse(outcome.lock)
      case "ok":
        opts.log(`[rove-bridge] ${stamp()} login from ${ip}: minted device ${outcome.name}`)
        return json(200, { token: outcome.token, device: outcome.name })
      case "failed": {
        opts.log(`[rove-bridge] ${stamp()} login failed from ${ip} (${outcome.count} in 24h)`)
        if (outcome.lock?.kind === "ip") opts.log(`[rove-bridge] ${stamp()} locked ${ip} for 15 minutes`)
        if (outcome.lock?.kind === "global") {
          opts.log(`[rove-bridge] ${stamp()} password login locked for everyone; run \`rove --web --unlock\``)
        }
        await new Promise((resolve) => setTimeout(resolve, delay()))
        return outcome.lock ? lockedResponse(outcome.lock) : json(401, { error: "login failed" })
      }
    }
  }

  /** Revokes the device token the request presents; the shared token is never revoked here. */
  function logout(req: Request, peer: string): Response {
    if (!sameOrigin(req)) return json(403, { error: "forbidden" })
    const device = deviceOf(opts.devicesPath, presentedToken(req))
    if (device && revokeDevice(opts.devicesPath, device)) {
      opts.log(`[rove-bridge] ${stamp()} device ${device} signed out from ${clientIp(req, peer)}`)
    }
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } })
  }

  return {
    async handle(req, peer) {
      const path = new URL(req.url).pathname
      if (path === "/logout" && req.method === "POST") return logout(req, peer)
      if (path !== "/login") return null
      if (!readPassword(paths.password)) return null
      // The page asks this before it has a token, to pick the login screen over the link prompt.
      if (req.method === "GET") return json(200, { password: true })
      if (req.method === "POST") return login(req, peer)
      return json(405, { error: "method not allowed" }, { Allow: "GET, POST" })
    },
  }
}
