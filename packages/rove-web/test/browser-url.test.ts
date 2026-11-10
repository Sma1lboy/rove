import { describe, expect, test } from "bun:test"
import { canFrame, frameNote, isLoopbackHost, normalizeUrl } from "../src/browser-url.ts"

const local = { origin: "http://127.0.0.1:7961", hostname: "127.0.0.1" }
const remote = { origin: "https://rove.example.com", hostname: "rove.example.com" }

describe("normalizeUrl", () => {
  test("a bare local address means http, anything else bare means https", () => {
    expect(normalizeUrl("localhost:3000")).toBe("http://localhost:3000/")
    expect(normalizeUrl("127.0.0.1:5173/app?x=1")).toBe("http://127.0.0.1:5173/app?x=1")
    expect(normalizeUrl("[::1]:8080")).toBe("http://[::1]:8080/")
    expect(normalizeUrl("example.com/docs")).toBe("https://example.com/docs")
    expect(normalizeUrl("  https://example.com  ")).toBe("https://example.com/")
  })

  test("other schemes, blanks and junk are refused", () => {
    for (const bad of [
      "",
      "   ",
      "javascript:alert(1)",
      "data:text/html,hi",
      "file:///etc/passwd",
      "blob:abc",
      "a b",
      "http://",
    ]) {
      expect(normalizeUrl(bad)).toBeNull()
    }
  })
})

describe("canFrame", () => {
  test("https is framed from anywhere", () => {
    expect(canFrame("https://example.com/", local)).toBe("yes")
    expect(canFrame("https://example.com/", remote)).toBe("yes")
  })

  test("a loopback address is the Rove machine's server: framed only by a page on that machine", () => {
    expect(canFrame("http://localhost:3000/", local)).toBe("yes")
    expect(canFrame("http://127.0.0.1:7962/", local)).toBe("yes")
    expect(canFrame("http://localhost:3000/", remote)).toBe("remote")
    expect(canFrame("https://localhost:8443/", remote)).toBe("remote")
    expect(canFrame("http://example.com/", local)).toBe("unreachable")
  })

  test("the bridge's word on where the page is beats the page's own address", () => {
    // Behind a tunnel on this machine the page address is public, yet `hello` says it is local.
    expect(canFrame("http://localhost:3000/", remote, true)).toBe("yes")
    expect(canFrame("http://localhost:3000/", local, false)).toBe("remote")
  })

  test("the page's own origin is never framed", () => {
    expect(canFrame("http://127.0.0.1:7961/x", local)).toBe("self")
    expect(canFrame("https://rove.example.com/", remote)).toBe("self")
  })
})

describe("frameNote", () => {
  const open = { reachable: true, frameable: true }

  test("a site that forbids framing, or cannot be reached, gets a note naming it; one that allows it none", () => {
    const url = "https://github.com/x"
    expect(frameNote(url, "yes", { reachable: true, frameable: false, reason: "X-Frame-Options: DENY" })).toEqual({
      key: "refuses",
      host: "github.com",
    })
    expect(frameNote(url, "yes", { reachable: false, frameable: false })).toEqual({
      key: "unreachable",
      host: "github.com",
    })
    expect(frameNote(url, "yes", open)).toBeNull()
  })

  test("a bridge that could not probe leaves the page to the browser", () => {
    expect(frameNote("https://example.com/", "yes", null)).toBeNull()
  })

  test("the address rules speak first, whatever a probe says", () => {
    expect(frameNote("http://localhost:3000/", "remote", open)).toEqual({ key: "remote", host: "localhost:3000" })
    expect(frameNote("http://example.com/", "unreachable", open)?.key).toBe("noFrame")
    expect(frameNote("https://rove.example.com/", "self", null)?.key).toBe("self")
  })
})

describe("isLoopbackHost", () => {
  test("covers localhost, 127/8 and ::1 only", () => {
    expect(isLoopbackHost("localhost")).toBe(true)
    expect(isLoopbackHost("app.localhost")).toBe(true)
    expect(isLoopbackHost("127.9.9.9")).toBe(true)
    expect(isLoopbackHost("[::1]")).toBe(true)
    expect(isLoopbackHost("128.0.0.1")).toBe(false)
    expect(isLoopbackHost("localhost.evil.com")).toBe(false)
  })
})
