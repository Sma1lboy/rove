/**
 * Legacy-path symlinks for the `.kobe` → `.rove` runtime move.
 *
 * The move is safe in one direction only. A NEW client finds an old daemon or
 * PTY host because the address resolver falls back to a legacy path while the
 * process holding it is alive (`paths.ts`). The reverse is not true: a binary
 * predating the rename knows exactly one path, so a new daemon binding
 * `.rove/daemon.sock` is invisible to it — and an invisible daemon is not an
 * error the old binary reports, it is a second daemon it starts, on the same
 * task index. Mixed installs are ordinary (a brew copy beside an npm one), so
 * this is a real state, not a hypothetical.
 *
 * A symlink at the legacy path closes that direction: `connect()` follows
 * symlinks, and so does every pidfile read. Cheap enough to do unconditionally
 * on every bind.
 *
 * Never clobbers a REAL file at the legacy path — that would be another
 * daemon's live socket or pidfile, and stealing it is the one thing
 * `socket-guard.ts` exists to prevent. A dangling link left after shutdown is
 * deliberately not cleaned up: it behaves exactly like the stale socket old
 * binaries have always had to tolerate.
 */

import { lstat, mkdir, symlink, unlink } from "node:fs/promises"
import { dirname } from "node:path"

/** Point `legacy` at `canonical`, unless something real already sits there. */
export async function linkLegacyRuntimePath(canonical: string, legacy: string): Promise<boolean> {
  if (canonical === legacy) return false
  try {
    const existing = await lstat(legacy).catch(() => null)
    if (existing && !existing.isSymbolicLink()) return false
    if (existing) await unlink(legacy).catch(() => {})
    await mkdir(dirname(legacy), { recursive: true })
    await symlink(canonical, legacy)
    return true
  } catch {
    // Read-only home, a race with another daemon, Windows without symlink
    // permission: compatibility is a courtesy, never a boot blocker.
    return false
  }
}
