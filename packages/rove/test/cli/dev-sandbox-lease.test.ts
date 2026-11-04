import { mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { SANDBOX_TTL_MS, expiredLeases, isThrowawayHome, touchLease } from "../../scripts/dev-sandbox-lease"

const dirs: string[] = []
function leaseDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rove-lease-"))
  dirs.push(dir)
  return dir
}

function ageLease(dir: string, ms: number): void {
  const when = new Date(Date.now() - ms)
  for (const entry of readdirSync(dir)) utimesSync(join(dir, entry), when, when)
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("sandbox leases", () => {
  it("a sandbox used within the TTL is kept, one idle past it is named by its home", () => {
    const dir = leaseDir()
    touchLease(dir, "/repo/.dev-sandbox/named/a/home")
    ageLease(dir, SANDBOX_TTL_MS - 60_000)
    expect(expiredLeases(dir, Date.now())).toEqual([])

    ageLease(dir, SANDBOX_TTL_MS + 60_000)
    expect(expiredLeases(dir, Date.now()).map((lease) => lease.home)).toEqual(["/repo/.dev-sandbox/named/a/home"])
  })

  it("using a sandbox again renews its lease", () => {
    const dir = leaseDir()
    touchLease(dir, "/tmp/box/home")
    ageLease(dir, SANDBOX_TTL_MS + 60_000)
    touchLease(dir, "/tmp/box/home")
    expect(expiredLeases(dir, Date.now())).toEqual([])
  })

  it("no lease directory yet means nothing to sweep", () => {
    expect(expiredLeases(join(leaseDir(), "absent"), Date.now())).toEqual([])
  })
})

describe("isThrowawayHome", () => {
  const base = "/repo/packages/rove/.dev-sandbox"
  const temp = ["/tmp"]

  it("covers the sandbox root and temp directories", () => {
    expect(isThrowawayHome(`${base}/named/x/home`, base, temp)).toBe(true)
    expect(isThrowawayHome("/tmp/sc-hero/home", base, temp)).toBe(true)
  })

  it("leaves a home elsewhere alone, including a sibling that only shares a prefix", () => {
    expect(isThrowawayHome("/Users/me/orbit/rec/home", base, temp)).toBe(false)
    expect(isThrowawayHome("/tmpfoo/home", base, temp)).toBe(false)
  })
})
