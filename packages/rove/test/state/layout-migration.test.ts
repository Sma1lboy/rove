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
import { preRenameConfigDir, preRenameStateDir } from "@sma1lboy/rove-daemon/daemon/pre-rename-runtime"
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
    write(`${preRenameStateDir("")}/tasks.json`, "legacy tasks")
    write(`${preRenameStateDir("")}/settings/keybindings.yaml`, "ctrl+x: task.close")
    write(`${preRenameStateDir("")}/issues.json`, "legacy issues")
    write(`${preRenameStateDir("")}/worktrees/repo/task/file`, "worktree")
    write(`${preRenameStateDir("")}/plugins/demo/state/value`, "plugin")
    write(`${preRenameStateDir("")}/daemon.pid`, "123")
    write(`${preRenameConfigDir("")}/state.json`, "legacy prefs")

    const result = migrateRoveStateLayout({ ROVE_HOME_DIR: root })

    expect(result).toMatchObject({ attempted: true, warnings: [] })
    expect(readFileSync(join(root, ".rove/tasks.json"), "utf8")).toBe("legacy tasks")
    expect(readFileSync(join(root, ".rove/settings/keybindings.yaml"), "utf8")).toContain("task.close")
    expect(readFileSync(join(root, ".rove/issues.json"), "utf8")).toBe("legacy issues")
    expect(readFileSync(join(root, ".config/rove/state.json"), "utf8")).toBe("legacy prefs")
    expect(existsSync(join(root, ".rove/worktrees"))).toBe(false)
    expect(existsSync(join(root, ".rove/plugins"))).toBe(false)
    expect(existsSync(join(root, ".rove/daemon.pid"))).toBe(false)
    expect(readFileSync(join(root, `${preRenameStateDir("")}/tasks.json`), "utf8")).toBe("legacy tasks")
  })

  test("never overwrites canonical files and does not repeat a completed migration", () => {
    root = mkdtempSync(join(tmpdir(), "rove-layout-"))
    write(`${preRenameStateDir("")}/tasks.json`, "legacy")
    write(`${preRenameStateDir("")}/settings/keybindings.yaml`, "legacy keys")
    write(".rove/tasks.json", "canonical")

    expect(migrateRoveStateLayout({ ROVE_HOME_DIR: root }).attempted).toBe(true)
    expect(readFileSync(join(root, ".rove/tasks.json"), "utf8")).toBe("canonical")
    expect(readFileSync(join(root, ".rove/settings/keybindings.yaml"), "utf8")).toBe("legacy keys")

    write(`${preRenameStateDir("")}/issues.json`, "added too late")
    expect(migrateRoveStateLayout({ ROVE_HOME_DIR: root })).toEqual({ attempted: false, copied: 0, warnings: [] })
    expect(existsSync(join(root, ".rove/issues.json"))).toBe(false)
  })

  test("defers daemon-owned files until daemon startup so the latest legacy write wins", () => {
    root = mkdtempSync(join(tmpdir(), "rove-layout-"))
    write(`${preRenameStateDir("")}/tasks.json`, "before old daemon write")
    write(`${preRenameStateDir("")}/settings/keybindings.yaml`, "legacy keys")

    expect(migrateRoveClientStateLayout({ ROVE_HOME_DIR: root }).warnings).toEqual([])
    expect(readFileSync(join(root, ".rove/settings/keybindings.yaml"), "utf8")).toBe("legacy keys")
    expect(existsSync(join(root, ".rove/tasks.json"))).toBe(false)

    write(`${preRenameStateDir("")}/tasks.json`, "latest old daemon write")
    expect(migrateRoveDaemonStateLayout({ ROVE_HOME_DIR: root }).warnings).toEqual([])
    expect(readFileSync(join(root, ".rove/tasks.json"), "utf8")).toBe("latest old daemon write")
  })

  test("copies symlinks as links without following their targets", () => {
    root = mkdtempSync(join(tmpdir(), "rove-layout-"))
    write(`${preRenameStateDir("")}/themes/base.json`, '{"name":"base"}')
    symlinkSync("base.json", join(root, `${preRenameStateDir("")}/themes/current.json`))

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
    write(`${preRenameConfigDir("")}/state.json`, "legacy prefs")
    const source = join(root, `${preRenameConfigDir("")}/state.json`)
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
    write(`${preRenameStateDir("")}/settings/keybindings.yaml`, "ctrl+x: task.close")
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

  test("retries a plugin tree left behind after its registry already moved", () => {
    root = mkdtempSync(join(tmpdir(), "rove-layout-partial-"))
    write(".rove/plugins.json", '{"plugins":[{"id":"demo"}]}')
    write(`${preRenameStateDir("")}/plugins/demo/config/.env`, "TOKEN=preserved")

    const result = migrateRoveDaemonStateLayout({ ROVE_HOME_DIR: root })

    expect(result.warnings).toEqual([])
    expect(readFileSync(join(root, ".rove/plugins/demo/config/.env"), "utf8")).toBe("TOKEN=preserved")
    expect(existsSync(join(preRenameStateDir(root), "plugins"))).toBe(false)
    expect(migrateRoveDaemonStateLayout({ ROVE_HOME_DIR: root }).attempted).toBe(false)
  })

  test("plugins MOVE to the canonical layout — one registry, not two", () => {
    root = mkdtempSync(join(tmpdir(), "rove-layout-"))
    write(`${preRenameStateDir("")}/plugins.json`, '{"plugins":[{"id":"demo"}]}')
    write(`${preRenameStateDir("")}/plugins/demo/config/.env`, "TOKEN=1")

    const first = migrateRoveDaemonStateLayout({ ROVE_HOME_DIR: root })
    expect(first.warnings).toEqual([])
    expect(readFileSync(join(root, ".rove/plugins.json"), "utf8")).toContain("demo")
    expect(readFileSync(join(root, ".rove/plugins/demo/config/.env"), "utf8")).toBe("TOKEN=1")
    expect(existsSync(join(preRenameStateDir(root), "plugins.json"))).toBe(false)
    expect(existsSync(join(preRenameStateDir(root), "plugins"))).toBe(false)
    expect(migrateRoveDaemonStateLayout({ ROVE_HOME_DIR: root }).attempted).toBe(false)
  })
})

/**
 * `ROVE_HOME_DIR=` (defined, blank) is this repo's own spelling of "unset".
 * Read as a VALUE the home becomes `""`, and every path here turns relative:
 * `join("", ".rove")` is `.rove`, resolved against the process's cwd — which
 * for the TUI is the user's repository. This module does not only copy; the
 * plugin tree is a `renameSync`, so a repo that happens to contain a
 * `.rove/plugins.json` gets it MOVED out from under it.
 */
describe("a blank ROVE_HOME_DIR is unset, not a home", () => {
  test("never moves a plugin registry relative to the process cwd", () => {
    root = mkdtempSync(join(tmpdir(), "rove-layout-"))
    write(`${preRenameStateDir("")}/plugins.json`, '{"plugins":[{"id":"real-home"}]}')

    // The decoy is the bug's exact shape: a checkout that happens to carry a
    // `.rove/plugins.json`, with the process sitting inside it.
    const repoCwd = mkdtempSync(join(tmpdir(), "rove-layout-cwd-"))
    mkdirSync(join(repoCwd, `${preRenameStateDir("")}`), { recursive: true })
    writeFileSync(join(repoCwd, `${preRenameStateDir("")}/plugins.json`), '{"plugins":[{"id":"users-repo"}]}', "utf8")

    const previousCwd = process.cwd()
    process.chdir(repoCwd)
    try {
      migrateRoveDaemonStateLayout({ ROVE_HOME_DIR: root })
    } finally {
      process.chdir(previousCwd)
    }

    try {
      // The negative half: the user's repo still holds its own file, as a real
      // file and not the symlink a completed move leaves behind, and no `.rove`
      // was created beside it.
      expect(lstatSync(join(repoCwd, `${preRenameStateDir("")}/plugins.json`)).isSymbolicLink()).toBe(false)
      expect(readFileSync(join(repoCwd, `${preRenameStateDir("")}/plugins.json`), "utf8")).toContain("users-repo")
      expect(existsSync(join(repoCwd, ".rove"))).toBe(false)
      // The positive half: the isolated home is the one that migrated.
      expect(readFileSync(join(root, ".rove/plugins.json"), "utf8")).toContain("real-home")
    } finally {
      rmSync(repoCwd, { recursive: true, force: true })
    }
  })
})
