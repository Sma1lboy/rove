import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseBridgeArgs } from "../src/cli-args.ts"
import { runPasswordAction } from "../src/password-cmd.ts"
import {
  EMPTY_LOCKOUT,
  GLOBAL_WINDOW_MS,
  IP_LOCK_MS,
  type LockoutState,
  hashPassword,
  lockOf,
  readLockout,
  readPassword,
  recordFailure,
  recordSuccess,
  verifyPassword,
  webPasswordPaths,
  writeLockout,
} from "../src/web-password.ts"

const dirs: string[] = []
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "rove-pw-"))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const fail = (state: LockoutState, ip: string, times: number, now: number): ReturnType<typeof recordFailure> => {
  let out = { state, lock: null } as ReturnType<typeof recordFailure>
  for (let i = 0; i < times; i++) out = recordFailure(out.state, ip, now + i)
  return out
}

describe("password hash", () => {
  test("verifies the right password only, with a random salt and N >= 2^15", async () => {
    const a = await hashPassword("test-only-pass")
    const b = await hashPassword("test-only-pass")
    expect(a.N).toBeGreaterThanOrEqual(2 ** 15)
    expect(a.salt).not.toBe(b.salt)
    expect(await verifyPassword(a, "test-only-pass")).toBe(true)
    expect(await verifyPassword(a, "test-only-pasS")).toBe(false)
  })

  test("--set-password prompts twice and stores only an owner-only hash", async () => {
    const dir = join(tempDir(), "bridge")
    const answers = ["throwaway-123", "throwaway-123"]
    expect(await runPasswordAction("set-password", dir, async () => answers.shift() ?? "")).toBe(0)
    const path = webPasswordPaths(dir).password
    expect(readFileSync(path, "utf8")).not.toContain("throwaway-123")
    const record = readPassword(path)
    expect(record && (await verifyPassword(record, "throwaway-123"))).toBe(true)
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600)

    const mismatch = ["throwaway-456", "throwaway-457"]
    expect(await runPasswordAction("set-password", dir, async () => mismatch.shift() ?? "")).toBe(1)
    expect(record && (await verifyPassword(readPassword(path) ?? record, "throwaway-123"))).toBe(true)

    await runPasswordAction("clear-password", dir)
    expect(readPassword(path)).toBeNull()
  })

  test("the password is never taken from argv", () => {
    expect(() => parseBridgeArgs(["--set-password", "hunter22"])).toThrow("takes no value")
    expect(parseBridgeArgs(["--set-password"]).action).toBe("set-password")
    expect(parseBridgeArgs(["--unlock"]).action).toBe("unlock")
  })
})

describe("lockout", () => {
  test("5 failures lock that IP for 15 minutes; others are untouched; the lock expires", () => {
    const t0 = 1_000_000
    const four = fail(EMPTY_LOCKOUT, "1.1.1.1", 4, t0)
    expect(four.lock).toBeNull()
    const five = recordFailure(four.state, "1.1.1.1", t0 + 10)
    expect(five.lock).toEqual({ kind: "ip", retryAfterMs: IP_LOCK_MS })
    expect(lockOf(five.state, "2.2.2.2", t0 + 11)).toBeNull()
    expect(lockOf(five.state, "1.1.1.1", t0 + 10 + IP_LOCK_MS)).toBeNull()
    // After expiry the count starts over: one more failure does not re-lock.
    expect(recordFailure(five.state, "1.1.1.1", t0 + 10 + IP_LOCK_MS).lock).toBeNull()
  })

  test("a success clears that IP's count but not the global one", () => {
    const four = fail(EMPTY_LOCKOUT, "1.1.1.1", 4, 0)
    const ok = recordSuccess(four.state, "1.1.1.1")
    expect(recordFailure(ok, "1.1.1.1", 10).lock).toBeNull()
    expect(ok.failures).toHaveLength(4)
  })

  test("20 failures within 24h lock everyone until unlocked; older ones fall out", () => {
    let state = EMPTY_LOCKOUT
    for (let i = 0; i < 19; i++) state = recordFailure(state, `10.0.0.${i}`, i).state
    expect(lockOf(state, "9.9.9.9", 100)).toBeNull()
    // The 20th a day later: the first 19 have aged out.
    expect(recordFailure(state, "9.9.9.9", GLOBAL_WINDOW_MS + 100).lock).toBeNull()
    const locked = recordFailure(state, "9.9.9.9", 200)
    expect(locked.lock).toEqual({ kind: "global" })
    // Sticky: a week later it is still locked.
    expect(lockOf(locked.state, "8.8.8.8", 7 * GLOBAL_WINDOW_MS)).toEqual({ kind: "global" })
  })

  test("counters survive a restart; --unlock clears them; a corrupt file fails closed", async () => {
    const dir = tempDir()
    const { lockout } = webPasswordPaths(dir)
    writeLockout(lockout, fail(EMPTY_LOCKOUT, "1.1.1.1", 5, 0).state)
    expect(lockOf(readLockout(lockout), "1.1.1.1", 100)?.kind).toBe("ip")
    await runPasswordAction("unlock", dir)
    expect(lockOf(readLockout(lockout), "1.1.1.1", 100)).toBeNull()
    await Bun.write(lockout, "{not json")
    expect(lockOf(readLockout(lockout), "1.1.1.1", 100)).toEqual({ kind: "global" })
  })
})
