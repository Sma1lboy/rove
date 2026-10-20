import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { DiscoverFailure, DiscoverResult } from "../../src/machines/discover.ts"
import type { MachineConfig } from "../../src/machines/registry.ts"
import { type SetupRuntime, authorizeKeyScript, establishMachine, hubKeyPath } from "../../src/machines/setup.ts"

const CONFIG: MachineConfig = { host: "otter", auth: { kind: "key" } }
const DENIED: DiscoverFailure = {
  ok: false,
  code: "SSH_FAILED",
  ssh: "auth-denied",
  message: "otter rejected every key",
}
const NO_ROVE: DiscoverFailure = { ok: false, code: "NO_ROVE", message: "Rove is not installed on otter" }
const OK: DiscoverResult = {
  ok: true,
  status: { socketPath: "/s", ptySocketPath: "/p", homeDir: "/h", hostname: "otter", roveVersion: "1", daemonPid: 1 },
}

/** A runtime whose `exec` records argv and creates the key a real ssh-keygen would. */
function runtime(probes: (DiscoverResult | DiscoverFailure)[], over: Partial<SetupRuntime> = {}) {
  const ran: string[][] = []
  const seen: MachineConfig[] = []
  const rt: SetupRuntime = {
    confirm: async () => true,
    exec: async (argv) => {
      ran.push([...argv])
      if (argv[0] === "ssh-keygen") {
        const key = argv[argv.indexOf("-f") + 1]!
        mkdirSync(dirname(key), { recursive: true })
        writeFileSync(key, "private")
        writeFileSync(`${key}.pub`, "ssh-ed25519 AAAA rove-hub@test\n")
      }
      return 0
    },
    out: () => {},
    ask: true,
    planOnly: false,
    discover: async (_alias, config) => {
      seen.push(config)
      return probes.shift() ?? probes.at(-1) ?? OK
    },
    ...over,
  }
  return { rt, ran, seen }
}

describe("establishMachine", () => {
  afterEach(() => rmSync(dirname(hubKeyPath()), { recursive: true, force: true }))

  it("answers a rejected key with a dedicated hub key, then logs in with it", async () => {
    const { rt, ran, seen } = runtime([DENIED, OK])
    const outcome = await establishMachine("otter", CONFIG, rt)
    expect(outcome).toMatchObject({ ok: true, config: { auth: { kind: "key", keyPath: hubKeyPath() } } })
    expect(ran.map((argv) => argv[0])).toEqual(["ssh-keygen", "ssh"])
    // The authorizing login is the one interactive ssh: no BatchMode, the public key in its command.
    expect(ran[1]).not.toContain("BatchMode=yes")
    expect(ran[1]?.at(-1)).toContain("ssh-ed25519 AAAA rove-hub@test")
    expect(seen[1]?.auth).toEqual({ kind: "key", keyPath: hubKeyPath() })
  })

  it("runs nothing past a declined fix", async () => {
    const { rt, ran } = runtime([NO_ROVE], { confirm: async () => false })
    expect(await establishMachine("otter", CONFIG, rt)).toMatchObject({ ok: false, failure: { code: "NO_ROVE" } })
    expect(ran).toEqual([])
  })

  it("only prints the plan without a terminal", async () => {
    const { rt, ran } = runtime([NO_ROVE], { planOnly: true })
    expect((await establishMachine("otter", CONFIG, rt)).ok).toBe(false)
    expect(ran).toEqual([])
  })

  it("stops when a fix did not cure the failure instead of offering it forever", async () => {
    const { rt, ran } = runtime([NO_ROVE, NO_ROVE, NO_ROVE])
    expect(await establishMachine("otter", CONFIG, rt)).toMatchObject({ ok: false, failure: { code: "NO_ROVE" } })
    expect(ran).toHaveLength(1)
    expect(ran[0]?.at(-1)).toBe("curl -fsSL https://rove.run/install.sh | sh")
  })
})

describe("authorizeKeyScript", () => {
  let home: string | null = null
  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true })
    home = null
  })

  it("appends the key once, owner-only, however often setup re-runs", () => {
    home = mkdtempSync(join(tmpdir(), "rove-authkeys-"))
    const script = authorizeKeyScript("ssh-ed25519 AAAA rove-hub@test")
    for (let i = 0; i < 2; i++) execFileSync("sh", ["-c", script], { env: { ...process.env, HOME: home } })
    const file = join(home, ".ssh", "authorized_keys")
    expect(readFileSync(file, "utf8")).toBe("ssh-ed25519 AAAA rove-hub@test\n")
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(statSync(join(home, ".ssh")).mode & 0o777).toBe(0o700)
  })
})
