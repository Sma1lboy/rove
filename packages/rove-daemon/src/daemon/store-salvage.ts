/**
 * What a file-backed store does when its file exists but cannot be read.
 *
 * Both automation stores answered a real failure (EACCES, EIO, a half-written
 * file) with "empty", then rewrote the file on the next change — the old
 * contents gone, nothing said. The task index already copies such a file to
 * `.corrupt-<ts>` before moving on; this is that rule for the rest.
 */

import { copyFileSync } from "node:fs"
import { logDaemonError } from "./crash-log.ts"

/** Move the unreadable file aside (best effort) so a later write cannot erase it. */
export function salvageUnreadable(path: string, subsystem: string, err: unknown): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const copy = `${path}.corrupt-${stamp}`
  try {
    copyFileSync(path, copy)
    logDaemonError(subsystem, new Error(`${String(err)} — unreadable file kept as ${copy}`))
  } catch (copyErr) {
    // A file that cannot even be copied is still not silently replaced: say so.
    logDaemonError(subsystem, new Error(`${String(err)} — and it could not be copied aside: ${String(copyErr)}`))
  }
}
