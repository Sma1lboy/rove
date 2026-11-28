/**
 * Core code (everything under src/ but the UI layers and the CLI's entry
 * files) must not import the TUI, so it can later stand as its own package.
 * Type imports count: a package split needs them gone too.
 */

import { readFileSync, readdirSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const SRC = fileURLToPath(new URL("../../src", import.meta.url))
const UI_DIRS = ["tui", "tui-react", "bundled-plugins"]
const UI_ROOTS = ["tui", "tui-react"].map((dir) => join(SRC, dir))

/** Shrink-only: files that still import the TUI, waiting to be moved off it. */
const NOT_YET_MOVED = new Set([
  "cli/api/exact-tab-delivery.ts",
  "cli/api/pty-delivery.ts",
  "cli/api/tab-launch.ts",
  "cli/api/tab-new.ts",
  "cli/api/tab-revive.ts",
  "cli/api/tab-split.ts",
  "engine/hosted-session.ts",
  "lib/failure-hint.ts",
  "machines/hub-singleton.ts",
  "machines/remote-worktree.ts",
  "tabs/terminal-tab-split.ts",
  "worktree/review-read.ts",
])

const SPEC = /(?:from|import\()\s*["']([^"']+)["']/g

function coreFiles(dir = SRC, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!(dir === SRC && UI_DIRS.includes(entry.name))) coreFiles(full, acc)
    } else if (/\.tsx?$/.test(entry.name) && dirname(full) !== join(SRC, "cli")) acc.push(full)
  }
  return acc
}

function importsTui(file: string): boolean {
  for (const [, spec = ""] of readFileSync(file, "utf8").matchAll(SPEC)) {
    const target = spec.startsWith("@/")
      ? join(SRC, spec.slice(2))
      : spec.startsWith(".")
        ? resolve(dirname(file), spec)
        : null
    if (target && UI_ROOTS.some((root) => target === root || target.startsWith(`${root}/`))) return true
  }
  return false
}

describe("core code does not import the TUI", () => {
  const offenders = coreFiles()
    .filter(importsTui)
    .map((file) => relative(SRC, file))

  test("no new core file imports src/tui or src/tui-react", () => {
    expect(offenders.filter((file) => !NOT_YET_MOVED.has(file))).toEqual([])
  })

  test("a file moved off the TUI leaves the not-yet-moved list", () => {
    expect([...NOT_YET_MOVED].filter((file) => !offenders.includes(file))).toEqual([])
  })
})
