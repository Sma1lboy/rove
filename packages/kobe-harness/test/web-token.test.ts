// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The browser half of web-transport auth: every daemon call must carry the
 * bearer token, or the daemon (correctly) 401s the dashboard.
 *
 * The module caches the token on first read, so each test re-imports it with
 * a fresh registry — otherwise the first test's DOM would fix the value for
 * all of them.
 */

async function freshModule(html: string | null) {
  vi.resetModules()
  if (html === null) {
    vi.stubGlobal("document", undefined)
  } else {
    document.head.innerHTML = html
  }
  return await import("../src/lib/web-token.ts")
}

describe("web token", () => {
  beforeEach(() => {
    document.head.innerHTML = ""
    sessionStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    document.head.innerHTML = ""
    sessionStorage.clear()
  })

  it("reads the token the daemon injected into the served HTML", async () => {
    const { webToken } = await freshModule('<meta name="rove-web-token" content="tok-123">')
    expect(webToken()).toBe("tok-123")
  })

  it("attaches it as a bearer header, preserving existing headers", async () => {
    const { withWebToken } = await freshModule('<meta name="rove-web-token" content="tok-123">')
    const init = withWebToken({ method: "POST", headers: { "content-type": "application/json" } })
    expect(init.headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer tok-123",
    })
  })

  it("appends it as a query param for EventSource, which cannot set headers", async () => {
    const { withWebTokenQuery } = await freshModule('<meta name="rove-web-token" content="tok 123">')
    expect(withWebTokenQuery("/events")).toBe("/events?token=tok%20123")
    expect(withWebTokenQuery("/events?x=1")).toBe("/events?x=1&token=tok%20123")
  })

  it("remembers the entry token for later loads that carry no meta tag", async () => {
    // The tag is injected only for a request that already presented the
    // token via `?token=` on the entry URL. An in-app route change drops that
    // query, so a reload arrives with neither channel and would otherwise go
    // out unauthenticated.
    const first = await freshModule('<meta name="rove-web-token" content="tok-entry">')
    expect(first.webToken()).toBe("tok-entry")

    const reload = await freshModule("")
    expect(reload.webToken()).toBe("tok-entry")
  })

  it("survives storage that throws (Safari private mode)", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("denied")
      },
      setItem: () => {
        throw new Error("denied")
      },
    })
    const { webToken } = await freshModule('<meta name="rove-web-token" content="tok-nostore">')
    expect(webToken()).toBe("tok-nostore")
  })

  it("leaves requests untouched when no token was injected (vite dev)", async () => {
    const { withWebToken, withWebTokenQuery } = await freshModule("")
    expect(withWebToken({ method: "GET" })).toEqual({ method: "GET" })
    expect(withWebTokenQuery("/events")).toBe("/events")
  })

  it("does not throw when imported without a DOM (node unit tests)", async () => {
    const { webToken } = await freshModule(null)
    expect(webToken()).toBe("")
  })
})

describe("fetch call-site wiring", () => {
  // The leaf tests above prove `withWebToken` builds the right header. This
  // one proves a real call site actually CALLS it: unhooking the helper leaves
  // every leaf test green while the request goes out unauthenticated.
  // `theme.ts` is the only remaining `withWebToken` caller — the api-client
  // that used to be the other one went with the web transport in #855.
  afterEach(() => vi.unstubAllGlobals())

  it("sends the bearer token on the themes fetch", async () => {
    vi.resetModules()
    document.head.innerHTML = '<meta name="rove-web-token" content="tok-wire">'
    const seen: RequestInit[] = []
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
      seen.push(init ?? {})
      return Promise.resolve(new Response(JSON.stringify({ themes: {} })))
    })

    const { applyThemeFromPrefs } = await import("../src/lib/theme.ts")
    applyThemeFromPrefs("claude")

    expect(seen).toHaveLength(1)
    expect(seen[0]?.headers).toMatchObject({ authorization: "Bearer tok-wire" })
  })

  it("sends the token on the SSE stream url", async () => {
    vi.resetModules()
    document.head.innerHTML = '<meta name="rove-web-token" content="tok-sse">'
    const { withWebTokenQuery } = await import("../src/lib/web-token.ts")
    // store.ts opens `new EventSource(withWebTokenQuery("/events"))`.
    expect(withWebTokenQuery("/events")).toContain("token=tok-sse")
  })
})
