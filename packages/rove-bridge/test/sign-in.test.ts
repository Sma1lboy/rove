import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { plainLocalRun } from "../src/local-access.ts"
import { createSignIn } from "../src/sign-in.ts"
import { createWebLogin } from "../src/web-login.ts"
import { start, stopServers, upgradeStatus } from "./server-harness.ts"

afterEach(stopServers)

const run = { preset: "none", hosts: ["127.0.0.1"], publicHost: null, relayServer: null } as const

function signIn(plain = true, config?: string) {
  const bridgeDir = mkdtempSync(join(tmpdir(), "rove-sign-in-"))
  const configPath = join(bridgeDir, "config.json")
  if (config !== undefined) writeFileSync(configPath, config)
  return { bridgeDir, configPath, signIn: createSignIn({ bridgeDir, configPath, plain, leaveOpen: () => "minted" }) }
}

test("only a loopback run with no preset, tunnel hostname or relay can be open", () => {
  expect(plainLocalRun(run)).toBe(true)
  expect(plainLocalRun({ ...run, hosts: ["127.0.0.1", "::1"] })).toBe(true)
  expect(plainLocalRun({ ...run, hosts: ["0.0.0.0"] })).toBe(false)
  expect(plainLocalRun({ ...run, hosts: ["192.168.1.20"] })).toBe(false)
  expect(plainLocalRun({ ...run, publicHost: "rove.example.com" })).toBe(false)
  expect(plainLocalRun({ ...run, preset: "cf" })).toBe(false)
  expect(plainLocalRun({ ...run, relayServer: "https://relay.example.com" })).toBe(false)
})

test("open: this computer's browser gets a socket without a token; anything forwarded does not", async () => {
  const h = start({ signIn: signIn().signIn })
  expect(await upgradeStatus(h.url)).toBe(101)
  // What cloudflared, `tailscale serve` and a reverse proxy add or rewrite on the way in.
  expect(await upgradeStatus(h.url, { "Cf-Connecting-Ip": "203.0.113.9" })).toBe(401)
  expect(await upgradeStatus(h.url, { "X-Forwarded-For": "203.0.113.9" })).toBe(401)
  expect(await upgradeStatus(h.url, { Host: "rove.example.com" })).toBe(401)
})

test("a run something else can reach is never open, whatever the config says", async () => {
  const reachable = signIn(false, JSON.stringify({ auth: "open" })).signIn
  expect(reachable.mode()).toBe("token")
  expect(reachable.modes()).toEqual(["password", "token"])
  const h = start({ signIn: reachable })
  expect(await upgradeStatus(h.url)).toBe(401)
  expect(await (await fetch(`${h.url.replace("ws://", "http://")}/auth`)).json()).toEqual({ open: false })
})

test("the older requireToken and a config that does not parse both ask for the token", () => {
  expect(signIn(true, JSON.stringify({ requireToken: true })).signIn.mode()).toBe("token")
  expect(signIn(true, "{ not json").signIn.mode()).toBe("token")
})

test("picking password needs one, then signs browsers in; picking token turns the password off without losing it", async () => {
  const made = signIn(true, JSON.stringify({ relayServer: "https://relay.example.com" }))
  const login = createWebLogin({
    enabled: () => made.signIn.mode() === "password",
    bridgeDir: made.bridgeDir,
    devicesPath: join(made.bridgeDir, "devices.json"),
    publicHost: null,
    trustForwardedIp: false,
    log: () => {},
  })
  const asks = async () => (await login.handle(new Request("http://127.0.0.1/login"), "127.0.0.1")) !== null

  await expect(made.signIn.set("password")).rejects.toThrow("a password is needed first")
  await expect(made.signIn.set("password", "short")).rejects.toThrow("8-1024")
  expect(made.signIn.mode()).toBe("open")

  // Leaving open hands the asking browser a token.
  expect(await made.signIn.set("password", "correct horse")).toBe("minted")
  expect(made.signIn.mode()).toBe("password")
  expect(await asks()).toBe(true)
  expect(JSON.parse(readFileSync(made.configPath, "utf8"))).toEqual({
    relayServer: "https://relay.example.com",
    auth: "password",
  })

  expect(await made.signIn.set("token")).toBeNull()
  expect(await asks()).toBe(false)
  // The password is still there: going back needs no new one.
  expect(await made.signIn.set("password")).toBeNull()
  expect(await asks()).toBe(true)
})
