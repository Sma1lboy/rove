/**
 * The frame probe (`rove-daemon/src/daemon/frame-check.ts`) behind `panel-show` and `browser.probe`:
 * which addresses it refuses to connect to, how it reads the two framing headers, and that a
 * refusal happens before any socket is opened.
 */

import { describe, expect, test } from "bun:test"
import {
  type HeadResponse,
  type ProbeDeps,
  checkFrame,
  isLoopbackHost,
  parseFrameHeaders,
  probeFrame,
  refusedAddress,
} from "@sma1lboy/rove-daemon/daemon/frame-check"
import { panelOps } from "../src/ops/panel.ts"

describe("addresses the probe will not connect to", () => {
  test.each([
    "10.0.0.1",
    "10.255.255.255",
    "127.0.0.1",
    "0.0.0.0",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "100.64.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "[::1]",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "::ffff:10.0.0.1",
    "::ffff:7f00:1",
    "::10.0.0.1",
    "2002:0a00:0001::1",
    "64:ff9b::a00:1",
    "not-an-ip",
  ])("refuses %s", (ip) => {
    expect(refusedAddress(ip)).not.toBeNull()
  })

  test.each([
    "93.184.216.34",
    "8.8.8.8",
    "172.32.0.1",
    "172.15.255.255",
    "100.63.255.255",
    "2606:2800:220:1::1",
    "::ffff:8.8.8.8",
  ])("allows %s", (ip) => {
    expect(refusedAddress(ip)).toBeNull()
  })

  test("loopback names are the viewer's own machine", () => {
    for (const host of ["localhost", "app.localhost", "127.0.0.1", "127.9.9.9", "::1", "[::1]", "0.0.0.0"]) {
      expect(isLoopbackHost(host)).toBe(true)
    }
    for (const host of ["example.com", "10.0.0.1", "localhost.example.com", "128.0.0.1"])
      expect(isLoopbackHost(host)).toBe(false)
  })
})

describe("framing headers", () => {
  test("DENY and SAMEORIGIN forbid framing from another origin, any case, even in a list", () => {
    expect(parseFrameHeaders({ xFrameOptions: ["DENY"] })).toEqual({
      frameable: false,
      reason: "X-Frame-Options: DENY",
    })
    expect(parseFrameHeaders({ xFrameOptions: ["sameorigin"] }).frameable).toBe(false)
    expect(parseFrameHeaders({ xFrameOptions: ["SAMEORIGIN, SAMEORIGIN"] }).frameable).toBe(false)
  })

  test("no framing header, or one no browser honours, leaves the page frameable", () => {
    expect(parseFrameHeaders({})).toEqual({ frameable: true })
    expect(parseFrameHeaders({ xFrameOptions: ["ALLOW-FROM https://a.example"] }).frameable).toBe(true)
    expect(parseFrameHeaders({ csp: ["default-src 'self'; script-src 'none'"] }).frameable).toBe(true)
  })

  test("frame-ancestors 'none' and 'self' forbid it; * allows it", () => {
    expect(parseFrameHeaders({ csp: ["frame-ancestors 'none'"] })).toMatchObject({ frameable: false })
    expect(parseFrameHeaders({ csp: ["default-src 'self'; frame-ancestors 'self'"] }).frameable).toBe(false)
    expect(parseFrameHeaders({ csp: ["frame-ancestors *"] }).frameable).toBe(true)
    expect(parseFrameHeaders({ csp: ["Frame-Ancestors *; img-src *"] }).frameable).toBe(true)
  })

  test("a named origin allows only the page it names; without our origin only * counts", () => {
    const csp = ["frame-ancestors https://app.example.com https://*.rove.run"]
    expect(parseFrameHeaders({ csp }).frameable).toBe(false)
    expect(parseFrameHeaders({ csp }, "https://app.example.com").frameable).toBe(true)
    expect(parseFrameHeaders({ csp }, "https://web.rove.run").frameable).toBe(true)
    expect(parseFrameHeaders({ csp }, "https://rove.run").frameable).toBe(false)
    expect(parseFrameHeaders({ csp }, "https://evil.example.com").frameable).toBe(false)
    expect(parseFrameHeaders({ csp }, "http://app.example.com").frameable).toBe(false)
    expect(parseFrameHeaders({ csp: ["frame-ancestors https:"] }, "https://anything.test").frameable).toBe(true)
    expect(parseFrameHeaders({ csp: ["frame-ancestors https:"] }, "http://anything.test").frameable).toBe(false)
  })

  test("every policy must allow it: one forbidding policy wins over a permissive one", () => {
    expect(parseFrameHeaders({ csp: ["frame-ancestors *", "frame-ancestors 'none'"] }).frameable).toBe(false)
    expect(parseFrameHeaders({ csp: ["frame-ancestors *, frame-ancestors 'self'"] }).frameable).toBe(false)
    expect(parseFrameHeaders({ xFrameOptions: ["DENY"], csp: ["frame-ancestors *"] }).frameable).toBe(false)
  })
})

/** A probe whose network is a fake: counts connections, answers one fixed response. */
function fake(addresses: string[], response?: Partial<HeadResponse>) {
  const heads: Array<{ ip: string; host: string; port: number; path: string }> = []
  const deps: ProbeDeps = {
    resolve: async () => addresses,
    head: async (target) => {
      heads.push(target)
      return { status: 200, headers: new Map(), ...response }
    },
  }
  return { deps, heads }
}

describe("probeFrame", () => {
  test("refuses a private address, a loopback one, and a name that resolves to one, without connecting", async () => {
    for (const [url, addresses] of [
      ["https://10.0.0.1/", []],
      ["https://[::1]/", []],
      ["https://intranet.example/", ["192.168.0.5"]],
      // A rebinding name answers with a public and a private record: one private answer refuses all.
      ["https://rebind.example/", ["93.184.216.34", "127.0.0.1"]],
      ["https://mapped.example/", ["::ffff:10.0.0.1"]],
    ] as const) {
      const { deps, heads } = fake([...addresses])
      const result = await probeFrame(url, { deps })
      expect(result).toMatchObject({ reachable: false, frameable: false })
      expect(result.reason).toContain("refused")
      expect(heads).toEqual([])
    }
  })

  test("connects to the address it vetted, naming the site only in SNI and Host, and reads the first response", async () => {
    const { deps, heads } = fake(["93.184.216.34"], {
      status: 200,
      headers: new Map([["x-frame-options", ["DENY"]]]),
    })
    const result = await probeFrame("https://example.com:8443/a?b=1", { deps })
    expect(result).toEqual({ reachable: true, frameable: false, status: 200, reason: "X-Frame-Options: DENY" })
    expect(heads).toEqual([{ ip: "93.184.216.34", host: "example.com:8443", port: 8443, path: "/a?b=1" }])
  })

  test("does not follow a redirect: the first response is the answer", async () => {
    const { deps, heads } = fake(["93.184.216.34"], {
      status: 301,
      headers: new Map([["location", ["https://elsewhere.example/"]]]),
    })
    const result = await probeFrame("https://example.com/", { deps })
    expect(result).toMatchObject({ reachable: true, frameable: true, status: 301 })
    expect(result.reason).toContain("https://elsewhere.example/")
    expect(heads).toHaveLength(1)
  })

  test("only https is probed, and a URL that is not one is an answer, not a throw", async () => {
    const { deps, heads } = fake(["93.184.216.34"])
    expect(await probeFrame("http://example.com/", { deps })).toMatchObject({ reachable: false, frameable: false })
    expect(await probeFrame("not a url", { deps })).toMatchObject({ reachable: false, frameable: false })
    expect(heads).toEqual([])
  })

  test("a host that never answers is cut off at the deadline", async () => {
    const deps: ProbeDeps = { resolve: async () => ["93.184.216.34"], head: () => new Promise(() => {}) }
    const started = Date.now()
    const result = await probeFrame("https://slow.example/", { deps })
    expect(result).toMatchObject({ reachable: false, frameable: false, reason: "timed out" })
    expect(Date.now() - started).toBeLessThan(4000)
  }, 6000)

  test("an unresolvable name is unreachable", async () => {
    const { deps } = fake([])
    expect(await probeFrame("https://nowhere.example/", { deps })).toMatchObject({ reachable: false, frameable: false })
  })
})

describe("checkFrame and the browser.probe op", () => {
  test("localhost is not probed; plain http elsewhere is not framed", async () => {
    expect(await checkFrame("http://localhost:3000/")).toMatchObject({ reachable: true, frameable: true })
    expect(await checkFrame("https://127.0.0.1:8443/")).toMatchObject({ frameable: true })
    expect(await checkFrame("http://example.com/")).toMatchObject({ frameable: false })
  })

  test("the op refuses a private address and bad arguments", async () => {
    const run = panelOps["browser.probe"]?.run
    expect(await run?.({ url: "https://10.0.0.1/" }, { api: {} as never })).toMatchObject({
      reachable: false,
      frameable: false,
    })
    await expect(run?.({}, { api: {} as never })).rejects.toMatchObject({ code: "BAD_ARGS" })
    await expect(run?.({ url: "https://example.com", origin: 5 }, { api: {} as never })).rejects.toMatchObject({
      code: "BAD_ARGS",
    })
  })
})
