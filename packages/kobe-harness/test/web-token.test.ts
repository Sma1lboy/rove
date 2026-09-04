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
    // The daemon injects the tag only for a request that already presented the
    // token — the `?token=` on the URL `rove web` prints. An in-app route
    // change drops that query, so a reload of /board arrives with neither
    // channel and would otherwise go out unauthenticated.
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

describe("api client wiring", () => {
  // The leaf tests above prove `withWebToken` builds the right header. This
  // one proves api-client actually CALLS it: unhooking the helper from
  // `requestJson` leaves every leaf test green while the real dashboard goes
  // out unauthenticated.
  afterEach(() => vi.unstubAllGlobals())

  it("sends the bearer token on every api verb", async () => {
    vi.resetModules()
    document.head.innerHTML = '<meta name="rove-web-token" content="tok-wire">'
    const { api } = await import("../src/lib/api-client.ts")
    const seen: RequestInit[] = []
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
      seen.push(init ?? {})
      return Promise.resolve(new Response(JSON.stringify({ ok: true })))
    })

    await api.get("/api/projects")
    await api.post("/api/rpc", { name: "task.list" })
    await api.patch("/api/settings", {})

    expect(seen).toHaveLength(3)
    for (const init of seen) {
      expect(init.headers).toMatchObject({ authorization: "Bearer tok-wire" })
    }
  })

  it("sends the token on the SSE stream url", async () => {
    vi.resetModules()
    document.head.innerHTML = '<meta name="rove-web-token" content="tok-sse">'
    const { withWebTokenQuery } = await import("../src/lib/web-token.ts")
    // store.ts opens `new EventSource(withWebTokenQuery("/events"))`.
    expect(withWebTokenQuery("/events")).toContain("token=tok-sse")
  })
})
