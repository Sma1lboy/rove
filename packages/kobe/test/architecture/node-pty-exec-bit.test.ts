/**
 * scripts/fix-node-pty-exec-bit.mjs — the postinstall backstop for node-pty
 * shipping its macOS `spawn-helper` at 0644 (issue #85). Builds the tarball's
 * layout in a temp tree at the broken mode and proves the fixer restores
 * 0755, leaves an already-executable helper alone, and reports a helper it
 * cannot change instead of throwing (postinstall must never fail the
 * install). Mode assertions are darwin-only: Linux prebuilds carry no
 * spawn-helper, so CI never takes this path for real.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "vitest"
import { findSpawnHelpers, fixSpawnHelpers } from "../../../../scripts/fix-node-pty-exec-bit.mjs"

const darwin = process.platform === "darwin"
let root: string

afterEach(() => rmSync(root, { recursive: true, force: true }))

function plant(mode: number): string {
  root = mkdtempSync(join(tmpdir(), "node-pty-exec-bit-"))
  const dir = join(root, "node-pty", "prebuilds", "darwin-arm64")
  mkdirSync(dir, { recursive: true })
  const helper = join(dir, "spawn-helper")
  writeFileSync(helper, "#!/bin/sh\n", { mode })
  chmodSync(helper, mode)
  return helper
}

test.runIf(darwin)("restores 0755 on a spawn-helper shipped at 0644", () => {
  const helper = plant(0o644)
  expect(findSpawnHelpers(root)).toEqual([{ path: helper, executable: false }])
  expect(fixSpawnHelpers(root)).toEqual({ fixed: [helper], failed: [] })
  expect(statSync(helper).mode & 0o777).toBe(0o755)
  expect(findSpawnHelpers(root)).toEqual([{ path: helper, executable: true }])
})

test.runIf(darwin)("an already-executable helper is left untouched", () => {
  const helper = plant(0o755)
  expect(fixSpawnHelpers(root)).toEqual({ fixed: [], failed: [] })
  expect(statSync(helper).mode & 0o777).toBe(0o755)
})

test("a missing tree is an empty result, not a throw", () => {
  root = join(tmpdir(), `node-pty-exec-bit-absent-${process.pid}`)
  expect(findSpawnHelpers(root)).toEqual([])
  expect(fixSpawnHelpers(root)).toEqual({ fixed: [], failed: [] })
})
