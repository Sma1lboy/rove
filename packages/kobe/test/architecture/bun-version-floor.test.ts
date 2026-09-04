/**
 * The minimum Bun version is written down in three places that cannot import
 * each other: `package.json#engines.bun` (the declaration), the launcher's
 * `MIN_BUN_VERSION` (the runtime gate), and `scripts/install.sh`'s `MIN_BUN`
 * (the curl installer, a POSIX shell script served from rove.run).
 *
 * A floor that drifts between them is invisible in the worst direction: the
 * install path would keep waving through a Bun the runtime then refuses, or
 * the declaration is raised for a new Bun API while the two enforcement
 * points keep waving through the version below it.
 *
 * So: package.json is the source of truth, and this test is what makes the
 * other two follow it. When you raise `engines.bun`, this test tells you the
 * other two spellings exist.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import pkg from "../../package.json" with { type: "json" }
import { MIN_BUN_VERSION, isBunAtLeast, parseBunVersion } from "../../src/cli/bun-runtime.ts"

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const installScript = readFileSync(join(REPO_ROOT, "scripts/install.sh"), "utf8")

describe("bun version floor", () => {
  test("package.json declares a concrete `>=x.y.z` floor", () => {
    expect(pkg.engines.bun).toMatch(/^>=\d+\.\d+\.\d+$/)
  })

  test("the launcher's floor is the declared one", () => {
    expect(MIN_BUN_VERSION).toBe(pkg.engines.bun.replace(">=", ""))
    expect(parseBunVersion(MIN_BUN_VERSION)).toBe(MIN_BUN_VERSION)
  })

  test("scripts/install.sh checks the same floor", () => {
    expect(installScript).toContain(`MIN_BUN="${MIN_BUN_VERSION}"`)
    // A MIN_BUN nothing reads would pass the line above and check nothing.
    expect(installScript).toContain('version_older "$BUN_VERSION" "$MIN_BUN"')
  })
})

describe("isBunAtLeast", () => {
  test("compares x.y.z componentwise, not lexically", () => {
    expect(isBunAtLeast("1.3.11", "1.3.11")).toBe(true)
    expect(isBunAtLeast("1.3.9", "1.3.11")).toBe(false)
    expect(isBunAtLeast("1.10.0", "1.9.0")).toBe(true)
    expect(isBunAtLeast("2.0.0", "1.3.11")).toBe(true)
    expect(isBunAtLeast("1.2.21", "1.3.11")).toBe(false)
    expect(isBunAtLeast("0.8.1", "1.3.11")).toBe(false)
  })

  test("reads a canary/prerelease tail as its release version", () => {
    expect(isBunAtLeast("1.3.11-canary.20260101", "1.3.11")).toBe(true)
    expect(isBunAtLeast("v1.2.0", "1.3.11")).toBe(false)
  })

  test("fails open on a version it cannot parse — refusing to start is worse", () => {
    expect(isBunAtLeast("", "1.3.11")).toBe(true)
    expect(isBunAtLeast("bun-but-weird", "1.3.11")).toBe(true)
  })
})
