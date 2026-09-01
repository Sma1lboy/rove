/**
 * The web transport's bearer token, as the browser sees it.
 *
 * The daemon serves index.html and rewrites a `<meta name="rove-web-token">`
 * into the head on the way out, so the token arrives with the page rather
 * than over a separate fetch. There is no endpoint to ask for it: an endpoint
 * reachable before the SPA holds a token would have to be unauthenticated,
 * which is the exact hole the token exists to close.
 *
 * Read once, but LAZILY on first use rather than at import: this module is
 * pulled in by `api-client.ts`, which unit tests import under node with no
 * DOM, and a module-load `document` read would throw there before any test
 * body runs. Cached after the first call — the served page carries one token
 * for its whole life, and rotating it means restarting the daemon, which
 * means reloading anyway.
 *
 * Absent in `vite dev`, where Vite (not the daemon) serves the HTML and so
 * nothing injects the tag. `VITE_ROVE_WEB_TOKEN` covers that case; without
 * either, requests go out bare and the daemon answers 401 with a hint.
 */
function readToken(): string {
  const injected =
    typeof document === "undefined"
      ? undefined
      : document.querySelector('meta[name="rove-web-token"]')?.getAttribute("content")?.trim()
  if (injected) return injected
  return (import.meta.env?.VITE_ROVE_WEB_TOKEN as string | undefined)?.trim() ?? ""
}

let cached: string | null = null

export function webToken(): string {
  if (cached === null) cached = readToken()
  return cached
}

/** Merge the bearer header into a fetch init, leaving it alone when we have
 *  no token (dev without the env var — the 401's hint is the better error). */
export function withWebToken(init: RequestInit): RequestInit {
  const token = webToken()
  if (!token) return init
  return { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` } }
}

/**
 * `EventSource` has no way to set a request header, so the SSE stream is the
 * one caller that must pass its token in the query string.
 */
export function withWebTokenQuery(url: string): string {
  const token = webToken()
  if (!token) return url
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
}
