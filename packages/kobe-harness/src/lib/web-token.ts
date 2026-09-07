/**
 * The PTY sidecar's bearer token, as the browser sees it.
 *
 * `VITE_ROVE_WEB_TOKEN` is the live channel, and currently the only one: Vite
 * serves the harness HTML, `dev.ts` mints the token and passes it in as that
 * env var, and `withWebTokenQuery` puts it on the WebSocket URL. Without it the
 * sidecar refuses the upgrade.
 *
 * The `<meta name="rove-web-token">` and `sessionStorage` branches below are
 * HISTORICAL. They read a tag the daemon-hosted web transport used to rewrite
 * into index.html for a request that had already presented the token — #855
 * deleted that transport, and nothing injects the tag any more (grep
 * `rove-web-token`: only this file and its tests). The `sessionStorage` pair
 * existed to carry that tag across a reload arriving without the query. Both
 * are unreachable in production; they are still exercised by
 * `test/web-token.test.ts` against a synthetic DOM. Removing them is a
 * deliberate deletion, not a cleanup to fold into an unrelated change — so
 * they stay until someone decides that, and a reader debugging a missing token
 * should look at `VITE_ROVE_WEB_TOKEN`, not for an injector.
 *
 * Read once, but LAZILY on first use rather than at import: this module is
 * pulled in by modules that unit tests import under node with no DOM, and a
 * module-load `document` read would throw there before any test body runs.
 * Cached after the first call — the served page carries one token for its
 * whole life, and rotating it means restarting the harness, which means
 * reloading anyway.
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
