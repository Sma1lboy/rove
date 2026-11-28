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
import { CLIENT_SRC, CORE_SRC } from "../core-package.ts"

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

const ROVE_PKG = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const CLIENT_PKG = resolve(CLIENT_SRC, "..")

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, acc)
    else if (/\.tsx?$/.test(entry.name)) acc.push(full)
  }
  return acc
}

describe("@sma1lboy/rove-core stands below the CLI package", () => {
  test("no rove-core file imports @sma1lboy/rove or a path inside packages/rove", () => {
    const offenders = walk(CORE_SRC).filter((file) =>
      [...readFileSync(file, "utf8").matchAll(SPEC)].some(([, spec = ""]) => {
        // The CLI manifest is the one thing core reads from the CLI package: it carries the product version.
        if (spec === "@sma1lboy/rove/package.json") return false
        if (spec === "@sma1lboy/rove" || spec.startsWith("@sma1lboy/rove/") || UI_PACKAGE.test(spec)) return true
        return spec.startsWith(".") && resolve(dirname(file), spec).startsWith(`${ROVE_PKG}/`)
      }),
    )
    expect(offenders.map((file) => relative(CORE_SRC, file))).toEqual([])
  })

  test("no rove-core file imports @sma1lboy/rove-client", () => {
    const offenders = walk(CORE_SRC).filter((file) =>
      [...readFileSync(file, "utf8").matchAll(SPEC)].some(([, spec = ""]) => {
        if (spec === "@sma1lboy/rove-client" || spec.startsWith("@sma1lboy/rove-client/")) return true
        return spec.startsWith(".") && resolve(dirname(file), spec).startsWith(`${CLIENT_PKG}/`)
      }),
    )
    expect(offenders.map((file) => relative(CORE_SRC, file))).toEqual([])
  })
})

describe("@sma1lboy/rove-client stands below the CLI package", () => {
  test("no rove-client file imports @sma1lboy/rove or a path inside packages/rove", () => {
    const offenders = walk(CLIENT_SRC).filter((file) =>
      [...readFileSync(file, "utf8").matchAll(SPEC)].some(([, spec = ""]) => {
        if (spec === "@sma1lboy/rove" || spec.startsWith("@sma1lboy/rove/") || UI_PACKAGE.test(spec)) return true
        return spec.startsWith(".") && resolve(dirname(file), spec).startsWith(`${ROVE_PKG}/`)
      }),
    )
    expect(offenders.map((file) => relative(CLIENT_SRC, file))).toEqual([])
  })
})
