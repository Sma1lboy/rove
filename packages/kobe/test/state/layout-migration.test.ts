import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import {
  migrateRoveClientStateLayout,
  migrateRoveDaemonStateLayout,
  migrateRoveStateLayout,
} from "../../src/state/layout-migration.ts"

let root: string | undefined

function write(relative: string, text: string): void {
  const path = join(root!, relative)
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, text, "utf8")
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  root = undefined
})

describe("migrateRoveStateLayout", () => {
  test("copies product data without moving legacy files or copying compatibility-only roots", () => {
    root = mkdtempSync(join(tmpdir(), "rove-layout-"))
    write(".kobe/tasks.json", "legacy tasks")
    write(".kobe/settings/keybindings.yaml", "ctrl+x: task.close")
    write(".kobe/issues.json", "legacy issues")
    write(".kobe/worktrees/repo/task/file", "worktree")
    write(".kobe/plugins/demo/state/value", "plugin")
    write(".kobe/daemon.pid", "123")
    write(".config/kobe/state.json", "legacy prefs")

    const result = migrateRoveStateLayout({ ROVE_HOME_DIR: root })

    expect(result).toMatchObject({ attempted: true, warnings: [] })
    expect(readFileSync(join(root, ".rove/tasks.json"), "utf8")).toBe("legacy tasks")
    expect(readFileSync(join(root, ".rove/settings/keybindings.yaml"), "utf8")).toContain("task.close")
    expect(readFileSync(join(root, ".rove/issues.json"), "utf8")).toBe("legacy issues")
    expect(readFileSync(join(root, ".config/rove/state.json"), "utf8")).toBe("legacy prefs")
    expect(existsSync(join(root, ".rove/worktrees"))).toBe(false)
    expect(existsSync(join(root, ".rove/plugins"))).toBe(false)
    expect(existsSync(join(root, ".rove/daemon.pid"))).toBe(false)
    expect(readFileSync(join(root, ".kobe/tasks.json"), "utf8")).toBe("legacy tasks")
  })

  test("never overwrites canonical files and does not repeat a completed migration", () => {
    root = mkdtempSync(join(tmpdir(), "rove-layout-"))
    write(".kobe/tasks.json", "legacy")
    write(".kobe/settings/keybindings.yaml", "legacy keys")
    write(".rove/tasks.json", "canonical")

    expect(migrateRoveStateLayout({ KOBE_HOME_DIR: root }).attempted).toBe(true)
    expect(readFileSync(join(root, ".rove/tasks.json"), "utf8")).toBe("canonical")
    expect(readFileSync(join(root, ".rove/settings/keybindings.yaml"), "utf8")).toBe("legacy keys")

    write(".kobe/issues.json", "added too late")
    expect(migrateRoveStateLayout({ ROVE_HOME_DIR: root })).toEqual({ attempted: false, copied: 0, warnings: [] })
    expect(existsSync(join(root, ".rove/issues.json"))).toBe(false)
  })

  test("does nothing on a fresh home without legacy data", () => {
    root = mkdtempSync(join(tmpdir(), "rove-layout-"))
    expect(migrateRoveStateLayout({ ROVE_HOME_DIR: root })).toEqual({ attempted: false, copied: 0, warnings: [] })
    expect(existsSync(join(root, ".rove"))).toBe(false)
  })

  test("defers daemon-owned files until daemon startup so the latest legacy write wins", () => {
    root = mkdtempSync(join(tmpdir(), "rove-layout-"))
    write(".kobe/tasks.json", "before old daemon write")
    write(".kobe/settings/keybindings.yaml", "legacy keys")

    expect(migrateRoveClientStateLayout({ ROVE_HOME_DIR: root }).warnings).toEqual([])
    expect(readFileSync(join(root, ".rove/settings/keybindings.yaml"), "utf8")).toBe("legacy keys")
    expect(existsSync(join(root, ".rove/tasks.json"))).toBe(false)

    write(".kobe/tasks.json", "latest old daemon write")
    expect(migrateRoveDaemonStateLayout({ ROVE_HOME_DIR: root }).warnings).toEqual([])
    expect(readFileSync(join(root, ".rove/tasks.json"), "utf8")).toBe("latest old daemon write")
  })

  test("copies symlinks as links without following their targets", () => {
    root = mkdtempSync(join(tmpdir(), "rove-layout-"))
    write(".kobe/themes/base.json", '{"name":"base"}')
    symlinkSync("base.json", join(root, ".kobe/themes/current.json"))

    const result = migrateRoveClientStateLayout({ ROVE_HOME_DIR: root })

    const migrated = join(root, ".rove/themes/current.json")
    expect(result.warnings).toEqual([])
    expect(lstatSync(migrated).isSymbolicLink()).toBe(true)
    expect(readlinkSync(migrated)).toBe("base.json")
  })

  // Regression: the temp file is flushed through a handle that must be
  // writable on Windows, and `copyFileSync` carries the legacy file's mode
  // onto it. A read-only source therefore breaks a naive "r" open (EPERM on
  // Windows) and a naive "r+" open (EACCES on POSIX) alike.
  test("migrates a read-only legacy file", () => {
    root = mkdtempSync(join(tmpdir(), "rove-layout-"))
    write(".config/kobe/state.json", "legacy prefs")
    const source = join(root, ".config/kobe/state.json")
    chmodSync(source, 0o444)

    try {
      const result = migrateRoveClientStateLayout({ ROVE_HOME_DIR: root })

      expect(result.warnings).toEqual([])
      expect(readFileSync(join(root, ".config/rove/state.json"), "utf8")).toBe("legacy prefs")
      expect(existsSync(join(root, ".rove/.layout-client-migration-v1"))).toBe(true)
    } finally {
      chmodSync(source, 0o644)
    }
  })

  test.skipIf(process.platform === "win32")("leaves the marker absent after a partial failure and retries", () => {
    root = mkdtempSync(join(tmpdir(), "rove-layout-"))
    write(".kobe/settings/keybindings.yaml", "ctrl+x: task.close")
    const blockedDir = join(root, ".rove/settings")
    mkdirSync(blockedDir, { recursive: true })
    chmodSync(blockedDir, 0o000)

    try {
      const failed = migrateRoveClientStateLayout({ ROVE_HOME_DIR: root })
      expect(failed.attempted).toBe(true)
      expect(failed.warnings).not.toEqual([])
      expect(existsSync(join(root, ".rove/.layout-client-migration-v1"))).toBe(false)
    } finally {
      chmodSync(blockedDir, 0o700)
    }

    const retried = migrateRoveClientStateLayout({ ROVE_HOME_DIR: root })
    expect(retried.warnings).toEqual([])
    expect(readFileSync(join(blockedDir, "keybindings.yaml"), "utf8")).toContain("task.close")
    expect(existsSync(join(root, ".rove/.layout-client-migration-v1"))).toBe(true)
  })

  test("plugins MOVE to the canonical layout — one registry, not two", () => {
    root = mkdtempSync(join(tmpdir(), "rove-layout-"))
    write(".kobe/plugins.json", '{"plugins":[{"id":"demo"}]}')
    write(".kobe/plugins/demo/config/.env", "TOKEN=1")

    const first = migrateRoveDaemonStateLayout({ ROVE_HOME_DIR: root })
    expect(first.warnings).toEqual([])
    expect(readFileSync(join(root, ".rove/plugins.json"), "utf8")).toContain("demo")
    expect(readFileSync(join(root, ".rove/plugins/demo/config/.env"), "utf8")).toBe("TOKEN=1")
    // MOVED, then linked back: a copy would leave a second registry for the
    // next writer, while a bare move blinds every pre-rename binary.
    expect(lstatSync(join(root, ".kobe/plugins.json")).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(root, ".kobe/plugins.json"), "utf8")).toContain("demo")
    expect(readFileSync(join(root, ".kobe/plugins/demo/config/.env"), "utf8")).toBe("TOKEN=1")

    // Idempotent: a second start finds the canonical registry and does nothing.
    expect(migrateRoveDaemonStateLayout({ ROVE_HOME_DIR: root }).attempted).toBe(false)
    // And the link is the whole compatibility story — an old binary writing to
    // the legacy path writes the canonical registry, not a second one.
    writeFileSync(join(root, ".kobe/plugins.json"), '{"plugins":[{"id":"from-old-cli"}]}', "utf8")
    expect(readFileSync(join(root, ".rove/plugins.json"), "utf8")).toContain("from-old-cli")
  })
})

/**
 * `ROVE_HOME_DIR=` (defined, blank) is this repo's own spelling of "unset".
 * Read as a VALUE the home becomes `""`, and every path here turns relative:
 * `join("", ".kobe")` is `.kobe`, resolved against the process's cwd — which
 * for the TUI is the user's repository. This module does not only copy; the
 * plugin tree is a `renameSync`, so a repo that happens to contain a
 * `.kobe/plugins.json` gets it MOVED out from under it.
 */
describe("a blank ROVE_HOME_DIR is unset, not a home", () => {
  test("falls through to KOBE_HOME_DIR rather than shadowing it", () => {
    root = mkdtempSync(join(tmpdir(), "rove-layout-"))
    write(".kobe/tasks.json", "legacy tasks")

    expect(migrateRoveStateLayout({ ROVE_HOME_DIR: "", KOBE_HOME_DIR: root })).toMatchObject({
      attempted: true,
      warnings: [],
    })
    expect(readFileSync(join(root, ".rove/tasks.json"), "utf8")).toBe("legacy tasks")
  })

  test("never moves a plugin registry relative to the process cwd", () => {
    root = mkdtempSync(join(tmpdir(), "rove-layout-"))
    write(".kobe/plugins.json", '{"plugins":[{"id":"real-home"}]}')

    // The decoy is the bug's exact shape: a checkout that happens to carry a
    // `.kobe/plugins.json`, with the process sitting inside it.
    const repoCwd = mkdtempSync(join(tmpdir(), "rove-layout-cwd-"))
    mkdirSync(join(repoCwd, ".kobe"), { recursive: true })
    writeFileSync(join(repoCwd, ".kobe/plugins.json"), '{"plugins":[{"id":"users-repo"}]}', "utf8")

    const previousCwd = process.cwd()
    process.chdir(repoCwd)
    try {
      migrateRoveDaemonStateLayout({ ROVE_HOME_DIR: "", KOBE_HOME_DIR: root })
    } finally {
      process.chdir(previousCwd)
    }

    try {
      // The negative half: the user's repo still holds its own file, as a real
      // file and not the symlink a completed move leaves behind, and no `.rove`
      // was created beside it.
      expect(lstatSync(join(repoCwd, ".kobe/plugins.json")).isSymbolicLink()).toBe(false)
      expect(readFileSync(join(repoCwd, ".kobe/plugins.json"), "utf8")).toContain("users-repo")
      expect(existsSync(join(repoCwd, ".rove"))).toBe(false)
      // The positive half: the isolated home is the one that migrated.
      expect(readFileSync(join(root, ".rove/plugins.json"), "utf8")).toContain("real-home")
    } finally {
      rmSync(repoCwd, { recursive: true, force: true })
    }
  })
})
