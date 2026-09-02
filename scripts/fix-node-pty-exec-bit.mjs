#!/usr/bin/env bun
// Restore the exec bit on node-pty's macOS `spawn-helper`.
//
// The published node-pty@1.1.0 tarball archives
// `prebuilds/darwin-{arm64,x64}/spawn-helper` at mode 0644 (`npm pack
// node-pty@1.1.0 && tar -tvzf …` shows it), and neither bun nor npm invents
// an exec bit the archive never carried. spawn-helper is the binary node-pty
// forks for every PTY on macOS, so without +x every spawn fails — and since
// `.rove/init.sh` runs `bun install` in each new worktree, the breakage came
// back on every task Rove created. Linux prebuilds ship no spawn-helper, so
// CI never saw it (issue #85).
//
// Runs from the root `postinstall`, the one hook both Rove-made worktrees and
// hand clones pass through. Idempotent; a no-op off macOS; never fails the
// install — a read-only store degrades to a warning, not a dead `bun install`.
//
// Usage: bun scripts/fix-node-pty-exec-bit.mjs [node_modules dir]

import { chmodSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

/** Every `spawn-helper` file under `root`, with whether the owner may execute it. */
export function findSpawnHelpers(root) {
  let entries
  try {
    entries = readdirSync(root, { recursive: true, withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name === "spawn-helper")
    .map((entry) => {
      const path = join(entry.parentPath, entry.name)
      return { path, executable: (statSync(path).mode & 0o100) !== 0 }
    })
}

/**
 * chmod 0755 every non-executable spawn-helper under `root`. Returns the
 * paths fixed and the ones that could not be (reason attached).
 */
export function fixSpawnHelpers(root) {
  const fixed = []
  const failed = []
  for (const helper of findSpawnHelpers(root)) {
    if (helper.executable) continue
    try {
      chmodSync(helper.path, 0o755)
      fixed.push(helper.path)
    } catch (err) {
      failed.push({ path: helper.path, reason: String(err) })
    }
  }
  return { fixed, failed }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.platform === "darwin") {
    const root = process.argv[2] ?? join(fileURLToPath(new URL("..", import.meta.url)), "node_modules")
    const { fixed, failed } = fixSpawnHelpers(root)
    for (const path of fixed) console.log(`[fix-node-pty-exec-bit] chmod 755 ${path}`)
    for (const { path, reason } of failed) console.warn(`[fix-node-pty-exec-bit] could not chmod ${path}: ${reason}`)
  }
}
