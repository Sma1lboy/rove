import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createLocalAccess, plainLocalRun } from "../src/local-access.ts"
import { start, stopServers, upgradeStatus } from "./server-harness.ts"

afterEach(stopServers)

const run = { preset: "none", hosts: ["127.0.0.1"], publicHost: null, relayServer: null } as const
const configPath = () => join(mkdtempSync(join(tmpdir(), "rove-local-access-")), "config.json")

test("only a loopback run with no preset, tunnel hostname or relay offers tokenless access", () => {
  expect(plainLocalRun(run)).toBe(true)
  expect(plainLocalRun({ ...run, hosts: ["127.0.0.1", "::1"] })).toBe(true)
  expect(plainLocalRun({ ...run, hosts: ["0.0.0.0"] })).toBe(false)
  expect(plainLocalRun({ ...run, hosts: ["192.168.1.20"] })).toBe(false)
  expect(plainLocalRun({ ...run, publicHost: "rove.example.com" })).toBe(false)
  expect(plainLocalRun({ ...run, preset: "cf" })).toBe(false)
  expect(plainLocalRun({ ...run, relayServer: "https://relay.example.com" })).toBe(false)
})

test("this computer's browser gets a socket without a token; anything forwarded does not", async () => {
  const h = start({ local: createLocalAccess(configPath(), () => "minted") })
  expect(await upgradeStatus(h.url)).toBe(101)
  // What cloudflared, `tailscale serve` and a reverse proxy add or rewrite on the way in.
  expect(await upgradeStatus(h.url, { "Cf-Connecting-Ip": "203.0.113.9" })).toBe(401)
  expect(await upgradeStatus(h.url, { "X-Forwarded-For": "203.0.113.9" })).toBe(401)
  expect(await upgradeStatus(h.url, { Host: "rove.example.com" })).toBe(401)
})

test("without local access a tokenless request is refused, and /auth says so", async () => {
  const h = start()
  expect(await upgradeStatus(h.url)).toBe(401)
  const res = await fetch(`${h.url.replace("ws://", "http://")}/auth`)
  expect(await res.json()).toEqual({ open: false })
})

test("requireToken in the config closes the door without a restart and keeps the other keys", async () => {
  const path = configPath()
  writeFileSync(path, JSON.stringify({ relayServer: "https://relay.example.com" }))
  const local = createLocalAccess(path, () => "minted")
  const h = start({ local })
  expect(await upgradeStatus(h.url)).toBe(101)

  expect(local.setRequireToken(true)).toBe("minted")
  expect(await upgradeStatus(h.url)).toBe(401)
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
    relayServer: "https://relay.example.com",
    requireToken: true,
  })

  expect(local.setRequireToken(false)).toBeNull()
  expect(await upgradeStatus(h.url)).toBe(101)
})

test("a config that does not parse asks for the token", async () => {
  const path = configPath()
  writeFileSync(path, "{ not json")
  const h = start({ local: createLocalAccess(path, () => "minted") })
  expect(await upgradeStatus(h.url)).toBe(401)
})
