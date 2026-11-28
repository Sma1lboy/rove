/**
 * The Browser view's address rules: what a typed string means, and whether this page may frame it.
 * A frame only works when the browser can reach the address and let a page embed it, so the view falls
 * back to a link everywhere else.
 */

export type Frameable =
  /** Shown in the frame. */
  | "yes"
  /** This page itself: it holds the bridge token, so it is never framed (the server forbids it too). */
  | "self"
  /** `http:` on another machine. */
  | "unreachable"
  /** A loopback address while this page is not on the machine Rove runs on: that server is out of reach. */
  | "remote"

const FILE = "file:"

/** A file in the task's directory as a tab's address: `file:` and its path relative to that directory. */
export const fileAddress = (path: string): string => `${FILE}${path}`

/** The path of a file address, or null for a web address. */
export const filePath = (url: string): string | null => (url.startsWith(FILE) ? url.slice(FILE.length) : null)

/** What the address bar shows for a file: its path on the machine. `root`: the task's directory, when known. */
export function fileShown(path: string, root: string | undefined): string {
  return root ? `${root.replace(/\/$/, "")}/${path}` : path
}

/** `path` cut at a folder boundary to what `fits`, the file name always whole: `…/rate/limiter.ts`. */
export function elidePath(path: string, fits: (text: string) => boolean): string {
  if (fits(path)) return path
  const parts = path.split("/")
  for (let i = 1; i < parts.length - 1; i++) {
    const tail = `…/${parts.slice(i).join("/")}`
    if (fits(tail)) return tail
  }
  return parts.length > 1 ? `…/${parts.at(-1)}` : path
}

/**
 * A typed local path (`/abs/x`, `./x`, `file:///abs/x`) as a file address; "outside" when it is not
 * under `root`, the only directory the bridge reads; null when it is not a path.
 */
export function normalizePath(input: string, root: string | undefined): string | "outside" | null {
  const text = input.trim().replace(/^file:\/\//i, "")
  let rel: string
  if (text.startsWith("./")) rel = text.slice(2)
  else if (text.startsWith("/")) {
    const base = root?.replace(/\/$/, "")
    if (!base || !text.startsWith(`${base}/`)) return "outside"
    rel = text.slice(base.length + 1)
  } else return null
  return rel && !rel.split("/").includes("..") ? fileAddress(rel) : "outside"
}

/** `localhost`, `127.0.0.0/8` and `[::1]`: the machine the browser runs on. */
export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127(\.\d{1,3}){3}$/.test(hostname)
  )
}

/** `localhost:3000`, `127.0.0.1`, `[::1]:8080/x`: a bare local address, which means `http`. */
const BARE_LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])(:\d+)?([/?#]|$)/i
/** A scheme (`javascript:`, `file:`), as opposed to `host:port`. */
const SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d+([/?#]|$))/i

/** What the user typed as an `http(s)` URL, or null when it is empty, unparsable or another scheme. */
export function normalizeUrl(input: string): string | null {
  const text = input.trim()
  if (!text || /\s/.test(text)) return null
  if (SCHEME.test(text) && !/^https?:\/\//i.test(text)) return null
  const withScheme = /^https?:\/\//i.test(text)
    ? text
    : BARE_LOOPBACK.test(text)
      ? `http://${text}`
      : `https://${text.replace(/^\/\//, "")}`
  try {
    const url = new URL(withScheme)
    // A CSP `frame-src` cannot name an IPv6 literal, so the page could never frame this one.
    if (url.hostname === "[::1]") url.hostname = "localhost"
    return url.hostname ? url.href : null
  } catch {
    return null
  }
}

/**
 * Whether a page at `page` (its `location`) may put `url` (from `normalizeUrl`) in an iframe. `local`:
 * this page is on the machine Rove runs on (the bridge says so in `hello`; a loopback page address
 * says so too), which is where a loopback address means the dev server.
 */
export function canFrame(
  url: string,
  page: Pick<Location, "origin" | "hostname">,
  local: boolean = isLoopbackHost(page.hostname),
): Frameable {
  const target = new URL(url)
  if (target.origin === page.origin) return "self"
  // A loopback address is the Rove machine's own server, whatever the scheme.
  if (isLoopbackHost(target.hostname)) return local ? "yes" : "remote"
  // Plain http elsewhere is mixed content on an https page and a dead end on the rest.
  return target.protocol === "https:" ? "yes" : "unreachable"
}

/** What the bridge's `browser.probe` says about an https page: one `HEAD` for `X-Frame-Options` and `frame-ancestors`. */
export interface FrameProbe {
  readonly reachable: boolean
  readonly frameable: boolean
  readonly reason?: string
}

/** The quiet one-liner for an address that will not be framed, or null when it will be (`browser.*` keys). */
export function frameNote(
  url: string,
  verdict: Frameable,
  probe: FrameProbe | null,
): { key: "noFrame" | "self" | "remote" | "refuses" | "unreachable"; host: string } | null {
  const host = new URL(url).host
  if (verdict === "self") return { key: "self", host }
  if (verdict === "remote") return { key: "remote", host }
  if (verdict === "unreachable") return { key: "noFrame", host }
  if (probe && !probe.reachable) return { key: "unreachable", host }
  if (probe && !probe.frameable) return { key: "refuses", host }
  return null
}
