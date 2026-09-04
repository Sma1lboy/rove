/**
 * The PTY sidecar's bearer token, as the browser sees it.
 *
 * The daemon rewrites a `<meta name="rove-web-token">` into index.html for a
 * request that ALREADY presented the token. It will not mint one for an
 * anonymous caller, because `/` is ungated (a browser cannot attach a header
 * to the subresources it fetches itself) and injecting there handed the
 * credential to any `curl`.
 *
 * So the meta tag only appears on the entry navigation. `sessionStorage`
 * carries it from there: a reload that arrives without the query would
 * otherwise have neither channel. Per-tab and per-origin, so it is scoped to
 * this browser profile — the local user who cannot read the 0600 token file
 * cannot read this either.
 *
 * Read once, but LAZILY on first use rather than at import: this module is
 * pulled in by modules that unit tests import under node with no DOM, and a
 * module-load `document` read would throw there before any test body runs.
 * Cached after the first call — the served page carries one token for its
 * whole life, and rotating it means restarting the daemon, which means
 * reloading anyway.
 *
 * Absent in `vite dev`, where Vite (not the daemon) serves the HTML and so
 * nothing injects the tag. `VITE_ROVE_WEB_TOKEN` covers that case; without
 * either, the sidecar refuses the WebSocket upgrade.
 */
const STORAGE_KEY = "rove-web-token"

/** Storage throws outright in a few configurations (Safari private mode,
 *  third-party-cookie blocking), and a dead dashboard is a worse outcome than
 *  re-opening the printed URL — so every access is best-effort. */
function remembered(): string {
  try {
    return sessionStorage.getItem(STORAGE_KEY)?.trim() ?? ""
  } catch {
    return ""
  }
}

function remember(token: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, token)
  } catch {
    /* storage unavailable — the token still works for this page load */
  }
}

function readToken(): string {
  if (typeof document !== "undefined") {
    const injected = document
      .querySelector('meta[name="rove-web-token"]')
      ?.getAttribute("content")
      ?.trim()
    if (injected) {
      remember(injected)
      return injected
    }
    const saved = remembered()
    if (saved) return saved
  }
  return (
    (import.meta.env?.VITE_ROVE_WEB_TOKEN as string | undefined)?.trim() ?? ""
  )
}

let cached: string | null = null

export function webToken(): string {
  if (cached === null) cached = readToken()
  return cached
}

/**
 * A WebSocket has no way to set a request header, so `ptyUrl` — the only
 * remaining caller, and the one route that spawns a shell — passes its token
 * in the query string.
 */
export function withWebTokenQuery(url: string): string {
  const token = webToken()
  if (!token) return url
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
}
