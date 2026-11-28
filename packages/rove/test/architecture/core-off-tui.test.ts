/**
 * Core code (everything under src/ but the UI layers and the CLI's entry
 * files) must not import the TUI, so it can later stand as its own package.
 * Nor any UI framework (`@opentui/*`, `react`). Type imports count: a package
 * split needs them gone too.
 */

import { readFileSync, readdirSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const SRC = fileURLToPath(new URL("../../src", import.meta.url))
const UI_DIRS = ["tui", "tui-react", "bundled-plugins"]
const UI_ROOTS = ["tui", "tui-react"].map((dir) => join(SRC, dir))

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

const UI_PACKAGE = /^(@opentui\/|react($|\/))/

function importsTui(file: string): boolean {
  for (const [, spec = ""] of readFileSync(file, "utf8").matchAll(SPEC)) {
    if (UI_PACKAGE.test(spec)) return true
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
  test("no core file imports src/tui, src/tui-react or a UI framework", () => {
    expect(
      coreFiles()
        .filter(importsTui)
        .map((file) => relative(SRC, file)),
    ).toEqual([])
  })
})
