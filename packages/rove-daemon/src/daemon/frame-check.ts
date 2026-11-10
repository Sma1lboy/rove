/**
 * Can a page be shown in the web side panel's iframe? One HEAD request answers it from the two
 * headers that forbid framing (`X-Frame-Options`, CSP `frame-ancestors`). Shared by
 * `panel.show` (the daemon) and the bridge's `browser.probe` op.
 *
 * The probe is an outbound fetch an agent or a browser can aim, so it stays narrow: HTTPS only,
 * HEAD only, the address it connects to is resolved first and refused when private, no redirect
 * is followed, and 3 seconds cover DNS and the whole exchange.
 */

import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { connect } from "node:tls"

export const PROBE_TIMEOUT_MS = 3_000
const MAX_HEAD_BYTES = 64 * 1024

export interface FrameProbe {
  /** False when the host did not answer, or the probe refused to ask it. */
  readonly reachable: boolean
  /** False when the page forbids framing, or could not be asked. */
  readonly frameable: boolean
  readonly reason?: string
  /** The first response's status; absent when no response came. */
  readonly status?: number
}

export interface FrameHeaders {
  readonly xFrameOptions?: readonly string[]
  /** Every enforcing `Content-Security-Policy` header value (never `-Report-Only`). */
  readonly csp?: readonly string[]
}

/** `localhost`, `*.localhost`, 127/8 and `::1`: names that mean the viewer's own machine. */
export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "")
  if (h === "localhost" || h.endsWith(".localhost")) return true
  const kind = isIP(h)
  if (kind === 4) return h.startsWith("127.") || h === "0.0.0.0"
  return kind === 6 && (parseV6(h)?.every((g, i) => g === (i === 7 ? 1 : 0)) ?? false)
}

function parseV4(ip: string): number[] | null {
  const parts = ip.split(".")
  if (parts.length !== 4) return null
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : Number.NaN))
  return octets.every((o) => o >= 0 && o <= 255) ? octets : null
}

/** Eight 16-bit groups, or null when `ip` is not IPv6. Takes `::` and a trailing dotted quad. */
function parseV6(raw: string): number[] | null {
  const ip = raw.split("%")[0] ?? ""
  if (isIP(ip) !== 6) return null
  let text = ip
  const lastColon = text.lastIndexOf(":")
  if (text.slice(lastColon + 1).includes(".")) {
    const v4 = parseV4(text.slice(lastColon + 1))
    if (!v4) return null
    const group = (hi: number | undefined, lo: number | undefined) => (((hi ?? 0) << 8) | (lo ?? 0)).toString(16)
    text = `${text.slice(0, lastColon + 1)}${group(v4[0], v4[1])}:${group(v4[2], v4[3])}`
  }
  const [head = "", rest] = text.split("::")
  const left = head === "" ? [] : head.split(":")
  const right = rest === undefined || rest === "" ? [] : rest.split(":")
  const fill = rest === undefined ? 0 : 8 - left.length - right.length
  if (fill < 0 || (rest === undefined && left.length !== 8)) return null
  const groups = [...left, ...Array<string>(fill).fill("0"), ...right].map((g) => Number.parseInt(g, 16))
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null
}

function refusedV4(o: readonly number[]): string | null {
  const [a = 0, b = 0, c = 0] = o
  if (a === 0) return "this-network address"
  if (a === 10) return "private address"
  if (a === 100 && b >= 64 && b <= 127) return "carrier-grade NAT address"
  if (a === 127) return "loopback address"
  if (a === 169 && b === 254) return "link-local address"
  if (a === 172 && b >= 16 && b <= 31) return "private address"
  if (a === 192 && b === 0 && c === 0) return "reserved address"
  if (a === 192 && b === 168) return "private address"
  if (a === 198 && (b === 18 || b === 19)) return "benchmarking address"
  if (a >= 224) return "multicast or reserved address"
  return null
}

/** Why the probe will not connect to this address, or null when it is public. Never throws. */
export function refusedAddress(ip: string): string | null {
  const addr = ip.replace(/^\[|\]$/g, "")
  const v4 = parseV4(addr)
  if (v4) return refusedV4(v4)
  const g = parseV6(addr)
  if (!g) return "not an IP address"
  const embedded = (hi: number, lo: number) => refusedV4([hi >> 8, hi & 255, lo >> 8, lo & 255])
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    // ::, ::1, ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible): the IPv4 inside decides.
    if (g.slice(5).every((x) => x === 0)) return "unspecified address"
    if (g[5] === 0 && g[6] === 0 && g[7] === 1) return "loopback address"
    return embedded(g[6] ?? 0, g[7] ?? 0) ?? null
  }
  const first = g[0] ?? 0
  if ((first & 0xfe00) === 0xfc00) return "unique-local address"
  if ((first & 0xffc0) === 0xfe80) return "link-local address"
  if ((first & 0xff00) === 0xff00) return "multicast address"
  if (first === 0x2002) return embedded(g[1] ?? 0, g[2] ?? 0) // 6to4
  if (first === 0x64 && g[1] === 0xff9b) return embedded(g[6] ?? 0, g[7] ?? 0) // NAT64
  if (first === 0x2001 && g[1] === 0x0db8) return "documentation address"
  return null
}

/** Does one `frame-ancestors` source list let `origin` (or, unknown, anybody) embed? */
function ancestorsAllow(sources: readonly string[], origin: string | undefined): boolean {
  let page: URL | null = null
  try {
    page = origin ? new URL(origin) : null
  } catch {
    page = null
  }
  return sources.some((raw) => {
    const source = raw.toLowerCase()
    if (source === "*") return true
    if (!page) return false
    if (source === `${page.protocol}`) return true
    if (source.endsWith(":") || source.startsWith("'")) return false
    let candidate: URL
    try {
      candidate = new URL(
        source.includes("://")
          ? source.replace("*.", "wildcard.")
          : `${page.protocol}//${source.replace("*.", "wildcard.")}`,
      )
    } catch {
      return false
    }
    const wildcard = candidate.hostname.startsWith("wildcard.")
    const host = wildcard ? candidate.hostname.slice("wildcard.".length) : candidate.hostname
    const hostOk = wildcard ? page.hostname.endsWith(`.${host}`) : page.hostname === host
    const portOk =
      source.endsWith(":*") ||
      (candidate.port || defaultPort(candidate.protocol)) === (page.port || defaultPort(page.protocol))
    return hostOk && portOk && candidate.protocol === page.protocol
  })
}

const defaultPort = (protocol: string) => (protocol === "https:" ? "443" : protocol === "http:" ? "80" : "")

/**
 * What the two framing headers say. `origin` is the embedding page's own origin; without it only
 * `frame-ancestors *` counts as permission. `ALLOW-FROM` is ignored: no current browser honours it.
 */
export function parseFrameHeaders(headers: FrameHeaders, origin?: string): { frameable: boolean; reason?: string } {
  for (const value of headers.xFrameOptions ?? []) {
    for (const part of value.split(",")) {
      const v = part.trim().toLowerCase()
      if (v === "deny" || v === "sameorigin") return { frameable: false, reason: `X-Frame-Options: ${v.toUpperCase()}` }
    }
  }
  for (const value of headers.csp ?? []) {
    for (const policy of value.split(",")) {
      for (const directive of policy.split(";")) {
        const [name, ...sources] = directive.trim().split(/\s+/)
        if (name?.toLowerCase() !== "frame-ancestors") continue
        if (!ancestorsAllow(sources, origin)) {
          return { frameable: false, reason: `Content-Security-Policy: frame-ancestors ${sources.join(" ")}`.trim() }
        }
      }
    }
  }
  return { frameable: true }
}

export interface HeadResponse {
  readonly status: number
  /** Lower-cased header name → every value received. */
  readonly headers: ReadonlyMap<string, readonly string[]>
}

export interface ProbeDeps {
  /** Every address `host` resolves to. */
  readonly resolve: (host: string) => Promise<readonly string[]>
  /** One HEAD over TLS to `ip`, with SNI and Host `host`. */
  readonly head: (
    target: { ip: string; host: string; port: number; path: string },
    signal: AbortSignal,
  ) => Promise<HeadResponse>
}

function parseHead(text: string): HeadResponse | null {
  const [statusLine = "", ...lines] = text.split("\r\n")
  const status = Number(/^HTTP\/\d(?:\.\d)? (\d{3})/.exec(statusLine)?.[1])
  if (!Number.isInteger(status)) return null
  const headers = new Map<string, string[]>()
  for (const line of lines) {
    const colon = line.indexOf(":")
    if (colon <= 0) continue
    const name = line.slice(0, colon).trim().toLowerCase()
    if (name !== "x-frame-options" && name !== "content-security-policy" && name !== "location") continue
    headers.set(name, [...(headers.get(name) ?? []), line.slice(colon + 1).trim()])
  }
  return { status, headers }
}

/** One HEAD to a vetted IP. Only the status line and the three headers the probe reads are kept. */
const headOverTls: ProbeDeps["head"] = (target, signal) => {
  const { promise, resolve, reject } = Promise.withResolvers<HeadResponse>()
  const socket = connect({ host: target.ip, port: target.port, servername: target.host })
  const fail = (err: Error) => {
    socket.destroy()
    reject(err)
  }
  signal.addEventListener("abort", () => fail(new Error("timed out")), { once: true })
  let received = ""
  socket.on("secureConnect", () => {
    socket.write(
      `HEAD ${target.path} HTTP/1.1\r\nHost: ${target.host}\r\nUser-Agent: rove-frame-probe\r\nAccept: */*\r\nConnection: close\r\n\r\n`,
    )
  })
  socket.on("data", (chunk) => {
    received += chunk.toString("latin1")
    const end = received.indexOf("\r\n\r\n")
    if (end < 0 && received.length < MAX_HEAD_BYTES) return
    const parsed = parseHead(end < 0 ? received : received.slice(0, end))
    socket.destroy()
    if (parsed) resolve(parsed)
    else reject(new Error("not an HTTP response"))
  })
  socket.on("error", fail)
  socket.on("close", () => fail(new Error("closed before a response")))
  return promise
}

const resolveAll: ProbeDeps["resolve"] = async (host) => (await lookup(host, { all: true })).map((a) => a.address)

const unframeable = (reason: string, reachable: boolean, status?: number): FrameProbe => ({
  reachable,
  frameable: false,
  reason,
  ...(status !== undefined ? { status } : {}),
})

/** The probe. Never throws: every failure is an answer with a `reason`. */
export async function probeFrame(
  rawUrl: string,
  opts: { origin?: string; deps?: Partial<ProbeDeps> } = {},
): Promise<FrameProbe> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return unframeable("not a URL", false)
  }
  if (url.protocol !== "https:") return unframeable("only https URLs are probed", false)
  const host = url.hostname.replace(/^\[|\]$/g, "")
  const deps: ProbeDeps = { resolve: resolveAll, head: headOverTls, ...opts.deps }
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS)
  const deadline = Promise.withResolvers<never>()
  deadline.promise.catch(() => {})
  abort.signal.addEventListener("abort", () => deadline.reject(new Error("timed out")), { once: true })
  const timedOut = deadline.promise
  try {
    const addresses = isIP(host) ? [host] : await Promise.race([deps.resolve(host), timedOut])
    if (addresses.length === 0) return unframeable(`${host} did not resolve`, false)
    // One private answer refuses the lot: a rebinding name mixes public and private records.
    for (const ip of addresses) {
      const why = refusedAddress(ip)
      if (why) return unframeable(`refused: ${isIP(host) ? host : `${host} resolves to ${ip}`} is a ${why}`, false)
    }
    const port = url.port ? Number(url.port) : 443
    const response = await Promise.race([
      deps.head(
        {
          ip: addresses[0] as string,
          host: url.host === url.hostname ? host : url.host,
          port,
          path: `${url.pathname}${url.search}` || "/",
        },
        abort.signal,
      ),
      timedOut,
    ])
    const verdict = parseFrameHeaders(
      {
        xFrameOptions: response.headers.get("x-frame-options") ?? [],
        csp: response.headers.get("content-security-policy") ?? [],
      },
      opts.origin,
    )
    const location = response.headers.get("location")?.[0]
    const redirected = response.status >= 300 && response.status < 400 && location
    return {
      reachable: true,
      frameable: verdict.frameable,
      status: response.status,
      ...(verdict.reason
        ? { reason: verdict.reason }
        : redirected
          ? { reason: `redirects to ${location} (not followed)` }
          : {}),
    }
  } catch (err) {
    return unframeable(err instanceof Error ? err.message : String(err), false)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * What to tell a caller about any URL: `localhost` pages are not probed (the viewer's own
 * machine decides whether it can reach them), plain `http` is framed for localhost only (the page
 * may itself be https), and an `https` page is asked.
 */
export async function checkFrame(
  rawUrl: string,
  opts: { origin?: string; deps?: Partial<ProbeDeps> } = {},
): Promise<FrameProbe> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return unframeable("not a URL", false)
  }
  if (isLoopbackHost(url.hostname)) return { reachable: true, frameable: true, reason: "localhost is not probed" }
  if (url.protocol === "http:") {
    return { reachable: true, frameable: false, reason: "http is framed for localhost only; open the page in a tab" }
  }
  return probeFrame(rawUrl, opts)
}
