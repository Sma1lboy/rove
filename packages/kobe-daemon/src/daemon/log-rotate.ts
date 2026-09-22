/**
 * Size-capped rotation for `daemon.log` / `client.log`: orphan panes spamming
 * reconnect failures grew `client.log` to hundreds of MB. One generation kept
 * (`<path>.old`); it is a debug trail, not an archive.
 */

import { existsSync, renameSync, statSync } from "node:fs"

export const DEFAULT_LOG_ROTATE_CAP_BYTES = 10 * 1024 * 1024 // 10MB

export function shouldRotateLog(sizeBytes: number, capBytes: number = DEFAULT_LOG_ROTATE_CAP_BYTES): boolean {
  return sizeBytes > capBytes
}

/**
 * Synchronous, at process boot before any writer (or inherited fd) opens the
 * path, so no write lands mid-rename. Best-effort: a failure never blocks startup.
 */
export function rotateLogIfNeeded(path: string, capBytes: number = DEFAULT_LOG_ROTATE_CAP_BYTES): void {
  try {
    if (!existsSync(path)) return
    const { size } = statSync(path)
    if (!shouldRotateLog(size, capBytes)) return
    renameSync(path, `${path}.old`)
  } catch {
    /* best-effort — never block startup/writes over a rotation failure */
  }
}
