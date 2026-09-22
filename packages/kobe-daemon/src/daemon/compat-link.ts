/**
 * Legacy-path symlinks for the `.kobe` → `.rove` runtime move. New clients fall
 * back to legacy paths (`paths.ts`), but a pre-rename binary knows one path: a
 * daemon on `.rove/daemon.sock` is invisible to it, so it starts a SECOND
 * daemon on the same task index. Mixed installs (brew beside npm) are ordinary.
 *
 * `connect()` and pidfile reads follow symlinks, so a link closes that gap.
 * Done on every bind, but only into a legacy state dir that already EXISTS
 * (else fresh installs get a `~/.kobe/` of dangling links; a legacy binary
 * that ran here would have made the dir itself).
 *
 * Never clobbers a REAL file there: that's another daemon's live socket or
 * pidfile (`socket-guard.ts`). Dangling links after shutdown are left alone;
 * old binaries already tolerate stale sockets.
 */

import { lstat, symlink, unlink } from "node:fs/promises"
import { dirname } from "node:path"

/** Point `legacy` at `canonical`, unless something real already sits there. */
export async function linkLegacyRuntimePath(canonical: string, legacy: string): Promise<boolean> {
  if (canonical === legacy) return false
  try {
    if (!(await lstat(dirname(legacy)).catch(() => null))) return false
    const existing = await lstat(legacy).catch(() => null)
    if (existing && !existing.isSymbolicLink()) return false
    if (existing) await unlink(legacy).catch(() => {})
    await symlink(canonical, legacy)
    return true
  } catch {
    // Read-only home, a race, no Windows symlink permission: never block boot.
    return false
  }
}
