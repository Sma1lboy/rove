/**
 * Kimi Code workspace trust. Kimi's first-launch "Trust this folder?" dialog
 * has no one to answer it in a hosted session. The default option is
 * version-specific (0.39.1 "Don't trust", so the first message's Enter exited
 * the engine; 0.40.1 "Trust") — pre-writing the record skips the dialog. A
 * Rove worktree is the same trust domain as its repo.
 *
 * One file per workspace:
 * `~/.kimi-code/workspace-trust/wd_<lowercased basename>_<sha256(realpath)[:12]>`
 * containing {"root": <realpath>, "trustedAt": <ms epoch>}.
 */

import { createHash } from "node:crypto"
import { mkdirSync, realpathSync, writeFileSync } from "node:fs"
import path from "node:path"
import { vendorConfigHome, vendorWriteHomeDeps } from "../vendor-home.ts"

/**
 * Kimi hashes the RESOLVED path and LOWERCASES the basename (read off records
 * kimi 0.40.1 wrote): `/tmp/x-B` on macOS → `wd_x-b_<sha256("/private/tmp/x-B")[:12]>`.
 * A record keyed on the literal path suppresses nothing. Falls back to the
 * given path when it doesn't exist yet.
 */
function resolvedWorktree(worktreePath: string): string {
  try {
    return realpathSync(worktreePath)
  } catch {
    return worktreePath /* not on disk yet — use what we were given */
  }
}

export function kimiTrustFilePath(worktreePath: string, home?: string): string {
  const resolved = resolvedWorktree(worktreePath)
  const hash = createHash("sha256").update(resolved).digest("hex").slice(0, 12)
  const dir = path.basename(resolved).toLowerCase()
  return path.join(vendorConfigHome("kimi", vendorWriteHomeDeps(home)), "workspace-trust", `wd_${dir}_${hash}`)
}

export function trustKimiWorktree(worktreePath: string, home?: string): void {
  const file = kimiTrustFilePath(worktreePath, home)
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  // `root` is resolved too, matching the records kimi writes itself.
  try {
    writeFileSync(file, JSON.stringify({ root: resolvedWorktree(worktreePath), trustedAt: Date.now() }), {
      mode: 0o600,
      flag: "wx",
    })
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
  }
}
