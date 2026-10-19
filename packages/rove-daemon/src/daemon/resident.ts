/**
 * Residency outlives the process: a resident daemon leaves a marker beside its
 * pidfile, so whichever path replaces it — `rove daemon restart`, a front-end's
 * Restart backend, an autospawn after a crash — boots resident too. Only an
 * explicit stop clears it.
 */

import { existsSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

export function residentMarkerPath(pidPath: string): string {
  return join(dirname(pidPath), "daemon.resident")
}

/** `--resident` on this boot, or a marker a resident predecessor left. */
export function resolveResident(requested: boolean, markerPath: string): boolean {
  return requested || existsSync(markerPath)
}

export function writeResidentMarker(markerPath: string): void {
  writeFileSync(markerPath, "")
}

export function clearResidentMarker(markerPath: string): void {
  rmSync(markerPath, { force: true })
}
