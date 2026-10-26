import { describe, expect, test } from "bun:test"
import { canFrame, isLoopbackHost, normalizeUrl } from "../src/browser-url.ts"

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

  test("plain http needs a loopback target and a page on the same machine", () => {
    expect(canFrame("http://localhost:3000/", local)).toBe("yes")
    expect(canFrame("http://127.0.0.1:7962/", local)).toBe("yes")
    expect(canFrame("http://localhost:3000/", remote)).toBe("unreachable")
    expect(canFrame("http://example.com/", local)).toBe("unreachable")
  })

  test("the page's own origin is never framed", () => {
    expect(canFrame("http://127.0.0.1:7961/x", local)).toBe("self")
    expect(canFrame("https://rove.example.com/", remote)).toBe("self")
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
