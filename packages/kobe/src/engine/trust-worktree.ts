/**
 * Worktree pre-trust at spawn time. A Rove-created worktree is
 * a directory the engine has never seen, and every vendor gates that behind
 * a first-run trust dialog a hosted session cannot answer — nobody is at the
 * pane to press a key, so the launch stalls on the dialog instead of starting
 * the turn. (Kimi's is the loudest failure: whether a stray Enter accepts or
 * EXITS the process depends on which option that kimi version defaults to.)
 * The vendor-specific
 * store writes live behind the registry's `trustWorktree` hook; THIS wrapper
 * owns the call policy every spawn path shares: best-effort, never blocks a
 * launch (a failed write just leaves the dialog in the user's way).
 */

import type { VendorId } from "../types/vendor.ts"
import { protocolEntry } from "./engine-presets.ts"

export function trustEngineWorktree(vendor: VendorId | undefined, worktreePath: string): void {
  try {
    protocolEntry(vendor).trustWorktree?.(worktreePath)
  } catch {
    /* best-effort — see the module doc */
  }
}
