import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LockfileError, acquire, isProcessAlive, release } from "../../src/orchestrator/index/lockfile.ts"

describe("isProcessAlive", () => {
  it("returns true for the current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true)
  })

  it("rejects non-positive / non-integer pids without throwing", () => {
    expect(isProcessAlive(0)).toBe(false)
    expect(isProcessAlive(-1)).toBe(false)
    expect(isProcessAlive(Number.NaN)).toBe(false)
    expect(isProcessAlive(1.5)).toBe(false)
  })

  it("returns false for a pid far above the typical max", () => {
    expect(isProcessAlive(999_999)).toBe(false)
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
    // Same pid, different token — the issue #53 topology (two stores, one
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
    // section while the thief is still inside it (issue #53's cascade).
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

  it("treats an EPERM kill probe as alive (exists but not signalable)", () => {
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
