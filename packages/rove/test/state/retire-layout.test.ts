import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { preRenameConfigDir, preRenameStateDir } from "@sma1lboy/rove-daemon/daemon/pre-rename-runtime"
import { afterEach, expect, test } from "vitest"
import { retirePreRenameLayout } from "../../src/state/retire-layout.ts"

let home = ""
afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true })
})
function fixture() {
  home = mkdtempSync(join(tmpdir(), "rove-retire-"))
  mkdirSync(preRenameStateDir(home), { recursive: true })
  mkdirSync(preRenameConfigDir(home), { recursive: true })
  mkdirSync(join(home, ".rove"), { recursive: true })
  return preRenameStateDir(home)
}

test("canonical files win while differing retired bytes survive outside the old directories", () => {
  const legacy = fixture()
  writeFileSync(join(legacy, "tasks.json"), "old tasks")
  writeFileSync(join(home, ".rove", "tasks.json"), "current tasks")
  writeFileSync(join(preRenameConfigDir(home), "state.json"), "settings")
  const result = retirePreRenameLayout(home)
  expect(result).toMatchObject({ retired: 2, retained: [], warnings: [] })
  expect(readFileSync(join(home, ".rove", "tasks.json"), "utf8")).toBe("current tasks")
  expect(readFileSync(join(home, ".rove", "migration-conflicts", "state", "tasks.json"), "utf8")).toBe("old tasks")
  expect(readFileSync(join(home, ".config", "rove", "state.json"), "utf8")).toBe("settings")
  expect(existsSync(legacy)).toBe(false)
  expect(existsSync(preRenameConfigDir(home))).toBe(false)
  expect(retirePreRenameLayout(home)).toEqual({ retired: 0, retained: [], warnings: [] })
})

test("live host files and Git worktrees keep their addresses while unrelated state retires", () => {
  const legacy = fixture()
  writeFileSync(join(legacy, "pty.pid"), String(process.pid))
  writeFileSync(join(legacy, "pty-exits.json"), "host state")
  mkdirSync(join(legacy, "worktrees"))
  writeFileSync(join(legacy, "notes.json"), "notes")
  expect(retirePreRenameLayout(home).warnings).toEqual([])
  expect(readFileSync(join(legacy, "pty-exits.json"), "utf8")).toBe("host state")
  expect(existsSync(join(legacy, "worktrees"))).toBe(true)
  expect(readFileSync(join(home, ".rove", "notes.json"), "utf8")).toBe("notes")
  unlinkSync(join(legacy, "pty.pid"))
  expect(retirePreRenameLayout(home).warnings).toEqual([])
  expect(existsSync(join(legacy, "pty-exits.json"))).toBe(false)
  expect(readFileSync(join(home, ".rove", "pty-exits.json"), "utf8")).toBe("host state")
  expect(existsSync(join(legacy, "worktrees"))).toBe(true)
})

test("a failed archive move leaves source bytes intact and retries after the blocker is gone", () => {
  const legacy = fixture()
  writeFileSync(join(legacy, "tasks.json"), "old")
  writeFileSync(join(home, ".rove", "tasks.json"), "current")
  writeFileSync(join(home, ".rove", "migration-conflicts"), "blocker")
  expect(retirePreRenameLayout(home).warnings).toHaveLength(1)
  expect(readFileSync(join(legacy, "tasks.json"), "utf8")).toBe("old")
  unlinkSync(join(home, ".rove", "migration-conflicts"))
  expect(retirePreRenameLayout(home).warnings).toEqual([])
  expect(existsSync(legacy)).toBe(false)
  expect(readFileSync(join(home, ".rove", "tasks.json"), "utf8")).toBe("current")
})

test.skipIf(process.platform === "win32")("moves symlink nodes without reading their targets", () => {
  const legacy = fixture()
  const outside = join(home, "outside")
  writeFileSync(outside, "untouched")
  symlinkSync(outside, join(legacy, "settings"))
  expect(retirePreRenameLayout(home).warnings).toEqual([])
  expect(lstatSync(join(home, ".rove", "settings")).isSymbolicLink()).toBe(true)
  expect(readFileSync(outside, "utf8")).toBe("untouched")
})

test("a live pre-rename daemon keeps its state and config in place", () => {
  const legacy = fixture()
  writeFileSync(join(legacy, "daemon.pid"), String(process.pid))
  writeFileSync(join(legacy, "tasks.json"), "active tasks")
  writeFileSync(join(preRenameConfigDir(home), "state.json"), "active config")
  const result = retirePreRenameLayout(home)
  expect(result.retired).toBe(0)
  expect(result.retained).toContain(join(legacy, "tasks.json"))
  expect(readFileSync(join(legacy, "tasks.json"), "utf8")).toBe("active tasks")
  expect(readFileSync(join(preRenameConfigDir(home), "state.json"), "utf8")).toBe("active config")
})
