import { mkdtempSync, readFileSync } from "node:fs"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The spawn profiler's two halves, both of which have to hold or the
 * instrument is worse than nothing: OFF must touch no disk (these calls sit
 * in paths that fork several times a second), and ON must actually write —
 * an instrument that reports nothing is indistinguishable from a quiet
 * system, which is the failure that sent the last investigation down a
 * monkey-patch that silently no-opped under Bun.
 *
 * `ROVE_SPAWN_PROFILE` is read at MODULE LOAD, so each case resets the module
 * registry and re-imports with the env already set — importing once and
 * flipping the variable afterwards would be testing a frozen constant.
 */
describe("spawn profile", () => {
  let dir: string
  let previous: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rove-spawn-profile-"))
    previous = process.env.ROVE_SPAWN_PROFILE
    vi.resetModules()
  })

  afterEach(() => {
    if (previous === undefined) Reflect.deleteProperty(process.env, "ROVE_SPAWN_PROFILE")
    else process.env.ROVE_SPAWN_PROFILE = previous
  })

  it("writes one JSON line per spawn, carrying the site, argv and cwd", async () => {
    const target = join(dir, "spawns.log")
    process.env.ROVE_SPAWN_PROFILE = target
    const { recordSpawn, spawnProfileOn } = await import("../../src/lib/spawn-profile.ts")
    expect(spawnProfileOn).toBe(true)

    recordSpawn("sidebar.worktreeChanges", ["git", "status", "--porcelain=v1"], "/wt/a")
    recordSpawn("engine.foregroundWalk", ["ps", "-A"])

    const rows = readFileSync(target, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      site: "sidebar.worktreeChanges",
      argv: ["git", "status", "--porcelain=v1"],
      cwd: "/wt/a",
      pid: process.pid,
    })
    // No cwd passed → the key is absent, not an empty string: "not recorded"
    // and "spawned in the root" must not read the same in the log.
    expect(rows[1]).toMatchObject({ site: "engine.foregroundWalk" })
    expect(rows[1]).not.toHaveProperty("cwd")
  })

  it("touches no disk when the variable is unset", async () => {
    Reflect.deleteProperty(process.env, "ROVE_SPAWN_PROFILE")
    const { recordSpawn, spawnProfileOn } = await import("../../src/lib/spawn-profile.ts")
    expect(spawnProfileOn).toBe(false)

    recordSpawn("sidebar.worktreeChanges", ["git", "status"], "/wt/a")

    // Nothing was created anywhere under the case's own directory.
    expect(existsSync(join(dir, "spawns.log"))).toBe(false)
  })

  it("survives an unwritable target instead of taking the process down", async () => {
    // A directory where the log file should be: every append throws.
    process.env.ROVE_SPAWN_PROFILE = dir
    const { recordSpawn } = await import("../../src/lib/spawn-profile.ts")
    expect(() => recordSpawn("tui.gitSnapshot", ["git", "status"], "/wt/a")).not.toThrow()
  })
})
