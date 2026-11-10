/**
 * `spawnGh` reports WHY it failed to spawn: a deleted worktree and a `gh` that
 * is not installed both surface as ENOENT, and the PR poller treats them very
 * differently (a gone worktree settles, a missing binary backs off). Pinned
 * against real spawns: an absent cwd, and an empty PATH with a live cwd.
 */

import { randomUUID } from "node:crypto"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnGh } from "@sma1lboy/rove-daemon/daemon/pr-gh-runner"
import { describe, expect, test } from "vitest"

describe("spawnGh", () => {
  test("a deleted worktree is cwdMissing, an uninstalled gh is not", async () => {
    const signal = new AbortController().signal
    const gone = await spawnGh(["pr", "view"], join(tmpdir(), `rove-gh-gone-${randomUUID()}`), signal)
    expect(gone.spawnError).toBe(true)
    expect(gone.cwdMissing).toBe(true)

    const live = mkdtempSync(join(tmpdir(), "rove-gh-live-"))
    const before = process.env.PATH
    process.env.PATH = join(live, "empty-bin")
    try {
      const noBinary = await spawnGh(["pr", "view"], live, signal)
      expect(noBinary.spawnError).toBe(true)
      expect(noBinary.cwdMissing).toBe(false)
    } finally {
      process.env.PATH = before
    }
  })
})
