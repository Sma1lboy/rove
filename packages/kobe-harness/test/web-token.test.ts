// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The browser half of the PTY sidecar's auth: the WebSocket upgrade must carry
 * the bearer token, or the sidecar (correctly) refuses it.
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

  it("appends it as a query param for the WebSocket, which cannot set headers", async () => {
    const { withWebTokenQuery } = await freshModule('<meta name="rove-web-token" content="tok 123">')
    expect(withWebTokenQuery("/pty")).toBe("/pty?token=tok%20123")
    expect(withWebTokenQuery("/pty?tab=1")).toBe("/pty?tab=1&token=tok%20123")
  })

  it("remembers the entry token for later loads that carry no meta tag", async () => {
    // The tag is injected only for a request that already presented the
    // token via `?token=` on the entry URL. A reload drops that query, so it
    // arrives with neither channel and the sidecar would refuse the upgrade.
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
    const { withWebTokenQuery } = await freshModule("")
    expect(withWebTokenQuery("/pty")).toBe("/pty")
  })

  it("does not throw when imported without a DOM (node unit tests)", async () => {
    const { webToken } = await freshModule(null)
    expect(webToken()).toBe("")
  })
})
