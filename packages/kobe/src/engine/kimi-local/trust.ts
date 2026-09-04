/**
 * Kimi Code workspace trust. Kimi shows a "Trust this folder?" dialog on
 * first launch in a directory, and a hosted session has no one to answer it:
 * the pane sits on the dialog instead of starting the turn. (Which option the
 * cursor rests on is version-specific — 0.39.1 defaulted to "Don't trust", so
 * a pasted first message's submit Enter exited the engine; 0.40.1 defaults to
 * "Trust this folder". Don't rely on either.) Pre-writing the record is what
 * skips the dialog outright, and a Rove-created worktree is the same trust
 * domain as the repo the user already runs sessions in.
 *
 * The store is one file per workspace:
 * `~/.kimi-code/workspace-trust/wd_<dirname>_<sha256(path)[:12]>` containing
 * {"root": <path>, "trustedAt": <ms epoch>}.
 */

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

/**
 * Reproduce kimi's own filename for a workspace. Two details are load-bearing,
 * both read off records kimi wrote itself (0.40.1, 2026-09-04): it hashes the
 * RESOLVED path, and it LOWERCASES the basename segment. For a worktree at
 * `/tmp/x-B` (macOS `/tmp` is a symlink to `/private/tmp`) kimi writes
 * `wd_x-b_<sha256("/private/tmp/x-B")[:12]>` — a record keyed on the literal
 * path suppresses no dialog at all.
 *
 * `realpathSync` throws on a path that isn't there yet; fall back to the given
 * one so this stays a pure function the caller can test.
 */
function resolvedWorktree(worktreePath: string): string {
  try {
    return realpathSync(worktreePath)
  } catch {
    return worktreePath /* not on disk yet — use what we were given */
  }
}

export function kimiTrustFilePath(worktreePath: string, home: string = homedir()): string {
  const resolved = resolvedWorktree(worktreePath)
  const hash = createHash("sha256").update(resolved).digest("hex").slice(0, 12)
  const dir = path.basename(resolved).toLowerCase()
  return path.join(home, ".kimi-code", "workspace-trust", `wd_${dir}_${hash}`)
}

export function trustKimiWorktree(worktreePath: string, home: string = homedir()): void {
  const file = kimiTrustFilePath(worktreePath, home)
  if (existsSync(file)) return
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  // `root` carries the resolved path too, so the record is shaped exactly like
  // one kimi writes for itself rather than only being FILED where kimi looks.
  writeFileSync(file, JSON.stringify({ root: resolvedWorktree(worktreePath), trustedAt: Date.now() }), { mode: 0o600 })
}
