import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { browserOriginAllowed, deviceOf, listDevices } from "../src/auth.ts"
import { type WebLoginOptions, createWebLogin } from "../src/web-login.ts"
import { hashPassword, webPasswordPaths, writePassword } from "../src/web-password.ts"
import { connect, start, stopServers } from "./server-harness.ts"

const PASSWORD = "throwaway-test-pw"
const dirs: string[] = []
afterEach(() => {
  stopServers()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function setup(withPassword = true, extra: Partial<WebLoginOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "rove-login-"))
  dirs.push(dir)
  if (withPassword) writePassword(webPasswordPaths(dir).password, await hashPassword(PASSWORD))
  const devicesPath = join(dir, "devices.json")
  const lines: string[] = []
  const login = createWebLogin({
    bridgeDir: dir,
    devicesPath,
    publicHost: "rove.example.com",
    trustForwardedIp: false,
    log: (line) => lines.push(line),
    failureDelayMs: () => 0,
    ...extra,
  })
  const h = start({ login, publicHost: "rove.example.com", deviceOf: (t) => deviceOf(devicesPath, t) })
  const http = h.url.replace("ws://", "http://").replace(/\/$/, "")
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${http}${path}`, {
      method: "POST",
      headers: { Origin: http, "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin", ...headers },
      body: JSON.stringify(body),
    })
  return { h, http, post, lines, devicesPath, dir }
}

describe("POST /login", () => {
  test("the right password mints a named device token that opens a socket", async () => {
    const s = await setup()
    const res = await s.post("/login", { password: PASSWORD })
    expect(res.status).toBe(200)
    const { token, device } = (await res.json()) as { token: string; device: string }
    expect(device).toMatch(/^web-login-\d{8}-\d{6}$/)
    expect(listDevices(s.devicesPath).map((d) => d.name)).toEqual([device])
    const ws = await connect(s.h.url, { Authorization: `Bearer ${token}` })
    expect((await ws.call("hello")).ok).toBe(true)
    // A second login gets its own token, not the first one's.
    const again = (await (await s.post("/login", { password: PASSWORD })).json()) as { device: string }
    expect(again.device).not.toBe(device)
    expect(s.lines.join("\n")).not.toContain(PASSWORD)
  })

  test("a wrong password is a generic 401; the 5th locks the IP with a 429 and time left", async () => {
    const s = await setup()
    for (let i = 0; i < 4; i++) {
      const res = await s.post("/login", { password: `wrong-${i}` })
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: "login failed" })
    }
    const fifth = await s.post("/login", { password: "wrong-4" })
    expect(fifth.status).toBe(429)
    expect(((await fifth.json()) as { retryAfterSeconds: number }).retryAfterSeconds).toBe(900)
    // Locked: even the right password is refused now.
    expect((await s.post("/login", { password: PASSWORD })).status).toBe(429)
    expect(listDevices(s.devicesPath)).toEqual([])
    const log = s.lines.join("\n")
    expect(log).toContain("login failed from 127.0.0.1")
    expect(log).toContain("locked 127.0.0.1 for 15 minutes")
    expect(log).not.toContain("wrong-")
  })

  test("a lock written by an earlier run still holds", async () => {
    const first = await setup()
    for (let i = 0; i < 5; i++) await first.post("/login", { password: "nope-nope" })
    stopServers()
    const login = createWebLogin({
      bridgeDir: first.dir,
      devicesPath: first.devicesPath,
      publicHost: null,
      trustForwardedIp: false,
      log: () => {},
      failureDelayMs: () => 0,
    })
    const h = start({ login })
    const http = h.url.replace("ws://", "http://").replace(/\/$/, "")
    const res = await fetch(`${http}/login`, {
      method: "POST",
      headers: { Origin: http, "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    })
    expect(res.status).toBe(429)
  })

  test("another site is refused, even with the right password", async () => {
    const s = await setup()
    expect((await s.post("/login", { password: PASSWORD }, { Origin: "https://evil.example" })).status).toBe(403)
    expect((await s.post("/login", { password: PASSWORD }, { "Sec-Fetch-Site": "cross-site" })).status).toBe(403)
    const noOrigin = await fetch(`${s.http}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    })
    expect(noOrigin.status).toBe(403)
    // The configured tunnel name is this page.
    expect((await s.post("/login", { password: PASSWORD }, { Origin: "https://rove.example.com" })).status).toBe(200)
    expect(listDevices(s.devicesPath)).toHaveLength(1)
  })

  test("CF-Connecting-IP counts only behind a configured tunnel", async () => {
    const plain = await setup()
    for (let i = 0; i < 5; i++) {
      await plain.post("/login", { password: "x-wrong-x" }, { "CF-Connecting-IP": `203.0.113.${i}` })
    }
    // Forged headers do not split the count: the socket address got locked.
    expect((await plain.post("/login", { password: PASSWORD }, { "CF-Connecting-IP": "203.0.113.99" })).status).toBe(
      429,
    )
    const tunnel = await setup(true, { trustForwardedIp: true })
    for (let i = 0; i < 5; i++) {
      await tunnel.post("/login", { password: "x-wrong-x" }, { "CF-Connecting-IP": "203.0.113.7" })
    }
    expect((await tunnel.post("/login", { password: PASSWORD }, { "CF-Connecting-IP": "203.0.113.8" })).status).toBe(
      200,
    )
  })

  test("with no password set there is no login route", async () => {
    const s = await setup(false)
    expect((await s.post("/login", { password: PASSWORD })).status).toBe(401)
    expect(listDevices(s.devicesPath)).toEqual([])
  })

  test("GET /login tells the page a password is set", async () => {
    const s = await setup()
    const res = await fetch(`${s.http}/login`)
    expect(await res.json()).toEqual({ password: true })
  })
})

describe("POST /logout", () => {
  test("revokes the presenting device's token only", async () => {
    const s = await setup()
    const { token } = (await (await s.post("/login", { password: PASSWORD })).json()) as { token: string }
    const other = (await (await s.post("/login", { password: PASSWORD })).json()) as { token: string }
    expect((await s.post("/logout", {}, { Authorization: `Bearer ${token}` })).status).toBe(204)
    await expect(connect(s.h.url, { Authorization: `Bearer ${token}` })).rejects.toThrow()
    expect(deviceOf(s.devicesPath, other.token)).not.toBeNull()
  })
})

test("a tunnel origin is this page only over https and only for the configured name", () => {
  expect(browserOriginAllowed("https://rove.example.com", "127.0.0.1:7878", "rove.example.com")).toBe(true)
  expect(browserOriginAllowed("http://rove.example.com", "127.0.0.1:7878", "rove.example.com")).toBe(false)
  expect(browserOriginAllowed("https://evil.example", "127.0.0.1:7878", "rove.example.com")).toBe(false)
  expect(browserOriginAllowed("https://rove.example.com", "127.0.0.1:7878", null)).toBe(false)
})
