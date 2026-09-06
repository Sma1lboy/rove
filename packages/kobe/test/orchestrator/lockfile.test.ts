import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isProcessAlive as daemonIsProcessAlive } from "@sma1lboy/kobe-daemon/daemon/lifecycle"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LockfileError, acquire, isProcessAlive, release } from "../../src/orchestrator/index/lockfile.ts"

describe("isProcessAlive", () => {
  it("returns true for the current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true)
  })

  // The pid guard, not defensive typing. `kill(0, 0)` targets the CALLER'S
  // OWN process group and SUCCEEDS, so without the guard a pidfile that
  // parsed to `0` reports a long-dead daemon as alive — and every caller
  // that waits for it to go away (restart, reset, the pty-host sweep) waits
  // forever. Drop `pid <= 0` and this case flips to `true`.
  it("rejects non-positive / non-integer pids without throwing", () => {
    expect(isProcessAlive(0)).toBe(false)
    expect(isProcessAlive(-1)).toBe(false)
    expect(isProcessAlive(Number.NaN)).toBe(false)
    expect(isProcessAlive(1.5)).toBe(false)
  })

  it("returns false for a pid far above the typical max", () => {
    expect(isProcessAlive(999_999)).toBe(false)
  })

  // ESRCH is the ONLY code that means gone. Everything else means the probe
  // failed, not that the process did — and every caller uses this answer to
  // decide whether to kill something or steal a lock, both unsafe on a guess.
  // (EPERM has its own test below, with the real `process.kill` mocked.)
  it.each([
    ["ESRCH", false],
    ["EPERM", true],
    ["EINVAL", true],
    [undefined, true],
  ] as const)("treats a %s kill probe as alive=%s", (code, alive) => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error(String(code)), code === undefined ? {} : { code })
    })
    try {
      expect(isProcessAlive(4242)).toBe(alive)
    } finally {
      killSpy.mockRestore()
    }
  })

  // The daemon used to carry its own copy with neither the pid guard nor the
  // non-ESRCH default (only EPERM counted as alive), so `lifecycle`'s answer
  // and the lockfile's disagreed on exactly the two cases above. One
  // implementation now, reached through both historical import paths.
  it("is the same function the daemon's lifecycle exports", () => {
    expect(daemonIsProcessAlive).toBe(isProcessAlive)
  })
})

describe("acquire / release", () => {
  let dir: string
  let lock: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kobe-lock-"))
    lock = join(dir, "index.lock")
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("creates a lockfile holding pid:token, then releases it idempotently", async () => {
    const token = await acquire(lock)
    expect(token.startsWith(`${process.pid}:`)).toBe(true)
    expect((await readFile(lock, "utf8")).trim()).toBe(token)
    await release(lock, token)
    // A second release of an already-gone lock must not throw.
    await expect(release(lock, token)).resolves.toBeUndefined()
  })

  it("rejects with LockfileError when held by a live process", async () => {
    await acquire(lock) // held by us — alive
    await expect(acquire(lock)).rejects.toBeInstanceOf(LockfileError)
  })

  it("rejects when a SIBLING holder in this same process holds the lock", async () => {
    // Same pid, different token — two stores in one
    // process). The holder is alive, so the second acquirer must wait, not
    // steal.
    await writeFile(lock, `${process.pid}:some-other-instance`)
    await expect(acquire(lock)).rejects.toBeInstanceOf(LockfileError)
    expect((await readFile(lock, "utf8")).trim()).toBe(`${process.pid}:some-other-instance`)
  })

  it("steals a stale lockfile whose holder is gone", async () => {
    await writeFile(lock, "999999") // a pid that does not exist
    const token = await acquire(lock)
    expect((await readFile(lock, "utf8")).trim()).toBe(token)
  })

  it("still reads the holder pid from a legacy bare-pid lock", async () => {
    await writeFile(lock, String(process.pid)) // pre-token format, alive holder
    await expect(acquire(lock)).rejects.toBeInstanceOf(LockfileError)
  })

  it("forceTakeover steals from a live holder", async () => {
    await acquire(lock) // held by us — alive
    const token = await acquire(lock, { forceTakeover: true })
    expect((await readFile(lock, "utf8")).trim()).toBe(token)
  })

  it("release only removes a lock we still own", async () => {
    // Victim acquires, thief takes over. The victim's release must NOT unlink
    // the thief's lock — that would let a third writer into the critical
    // section while the thief is still inside it.
    const victim = await acquire(lock)
    const thief = await acquire(lock, { forceTakeover: true })
    await release(lock, victim)
    expect((await readFile(lock, "utf8")).trim()).toBe(thief)
    await release(lock, thief)
    await expect(readFile(lock, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
  })
})

describe("acquire / release — edge branches", () => {
  const dir = mkdtempSync(join(tmpdir(), "kobe-lock-edge-"))
  const lockPath = join(dir, "edge.lock")

  afterEach(async () => {
    await rm(lockPath, { force: true })
  })

  it("treats an EPERM kill probe on a real system pid as alive", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("EPERM"), { code: "EPERM" })
    })
    try {
      expect(isProcessAlive(1)).toBe(true)
    } finally {
      killSpy.mockRestore()
    }
  })

  it("steals a lockfile whose content isn't a pid at all", async () => {
    writeFileSync(lockPath, "not-a-pid")
    const token = await acquire(lockPath)
    expect(readFileSync(lockPath, "utf8")).toBe(token)
  })

  it("release tolerates a lock that's already gone", async () => {
    await expect(release(join(dir, "never-existed.lock"), "any-token")).resolves.toBeUndefined()
  })
})
