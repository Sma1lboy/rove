import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ROVE_STATE_DIR_BASENAME } from "@sma1lboy/kobe-daemon/compat-env"
import {
  OWNER_ONLY_DIR_MODE,
  OWNER_ONLY_FILE_MODE,
  ensureOwnerOnlyDir,
  ensureOwnerOnlyStateDir,
  tightenDirPermissions,
  tightenFilePermissions,
} from "@sma1lboy/kobe-daemon/daemon/owner-only"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

/**
 * `<home>/.rove` is the daemon's ONLY access control. `server.ts` accepts
 * every connection on the socket with no peer-credential check, so reaching
 * that socket is `add` — launching an engine, which is arbitrary execution as
 * the owner. Nothing in the daemon may assume the mode without setting it, and
 * nothing was measuring that it did: a `chmod(path, 0o755)` in this module
 * left both vitest tracks fully green.
 *
 * The population these assertions have to build is the one the module exists
 * for. `mkdirSync`'s `mode` binds at `O_CREAT` and is a silent no-op for a
 * path that already exists, so a home created before the mode argument landed
 * keeps 0755 forever — the repair pass on every start is the only thing that
 * ever narrows it. So each case here PRE-CREATES the loose path and reads the
 * real mode back with `statSync`; a fresh-directory-only test would pass with
 * the repair deleted.
 *
 * Real filesystem, no mocks: the thing under test is a syscall's effect.
 */
describe("owner-only state tree", () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "rove-owner-only-"))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /** Permission bits only — the file-type bits in `st_mode` are not ours. */
  function mode(path: string): number {
    return statSync(path).mode & 0o777
  }

  it("repairs a directory that already exists at a world-readable mode", async () => {
    const dir = join(root, "state")
    mkdirSync(dir, { mode: 0o755 })
    expect(mode(dir)).toBe(0o755)

    await ensureOwnerOnlyDir(dir)

    expect(mode(dir)).toBe(OWNER_ONLY_DIR_MODE)
    expect(mode(dir)).toBe(0o700)
  })

  it("creates a missing tree owner-only in the first place", async () => {
    const dir = join(root, "fresh", "nested")

    await ensureOwnerOnlyDir(dir)

    expect(mode(dir)).toBe(0o700)
  })

  it("tightens `<home>/.rove` — the directory the socket's security rests on", async () => {
    const stateDir = join(root, ROVE_STATE_DIR_BASENAME)
    mkdirSync(stateDir, { mode: 0o777 })

    await ensureOwnerOnlyStateDir(root)

    expect(mode(stateDir)).toBe(0o700)
  })

  it("tightens an existing group/world-readable file to 0600", async () => {
    const file = join(root, "web-token")
    writeFileSync(file, "secret", { mode: 0o644 })
    expect(mode(file)).toBe(0o644)

    await tightenFilePermissions(file)

    expect(mode(file)).toBe(OWNER_ONLY_FILE_MODE)
    expect(mode(file)).toBe(0o600)
  })

  it("never throws on a path that is not there", async () => {
    // Best-effort is the contract: a chmod that cannot run (absent, foreign
    // owner, a filesystem with no unix modes) must not keep the daemon from
    // booting. A loose mode is worse than a tight one; neither is worse than a
    // daemon that will not start.
    await expect(tightenDirPermissions(join(root, "gone"))).resolves.toBeUndefined()
    await expect(tightenFilePermissions(join(root, "gone.json"))).resolves.toBeUndefined()
  })
})
