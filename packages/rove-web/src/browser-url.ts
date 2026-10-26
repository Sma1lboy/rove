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
  /** `http:` on another machine, or a loopback address while this page is not on that machine. */
  | "unreachable"

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
    return url.hostname ? url.href : null
  } catch {
    return null
  }
}

/** Whether a page at `page` (its `location`) may put `url` (from `normalizeUrl`) in an iframe. */
export function canFrame(url: string, page: Pick<Location, "origin" | "hostname">): Frameable {
  const target = new URL(url)
  if (target.origin === page.origin) return "self"
  if (target.protocol === "https:") return "yes"
  // Plain http only reaches a dev server on this machine, and only while this page is on this machine too.
  return isLoopbackHost(target.hostname) && isLoopbackHost(page.hostname) ? "yes" : "unreachable"
}
