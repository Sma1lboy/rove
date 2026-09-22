/**
 * Once-per-upgrade What's New gate, keyed on `app.whatsNewSeenVersion`.
 *
 * ORDERING: {@link takeWhatsNew} must run BEFORE `enforceResetGate()`: without
 * the key it falls back to `app.lastRunVersion`, which the reset gate rewrites
 * to the current version.
 */

import { type StateSnapshot, loadStateFile, patchStateFile } from "../state/store.ts"
import { CURRENT_VERSION, compareSemver } from "../version.ts"
import { LAST_RUN_VERSION_KEY } from "./reset-gate.ts"

export const WHATS_NEW_SEEN_KEY = "app.whatsNewSeenVersion"

/**
 * The last-shown version when What's New should open, else null: fresh install
 * (no stamp), same build, or a DOWNGRADE (no forward range to list).
 */
export function whatsNewFromVersion(state: StateSnapshot, current: string = CURRENT_VERSION): string | null {
  const stamped = state[WHATS_NEW_SEEN_KEY] ?? state[LAST_RUN_VERSION_KEY]
  if (typeof stamped !== "string" || stamped.length === 0) return null
  return compareSemver(current, stamped) > 0 ? stamped : null
}

/** Decide and stamp at once, so a later boot crash can't make the page recur.
 *  Best-effort write: a read-only FS must not stop the TUI. */
export function takeWhatsNew(): string | null {
  const from = whatsNewFromVersion(loadStateFile())
  try {
    patchStateFile({ [WHATS_NEW_SEEN_KEY]: CURRENT_VERSION })
  } catch {
    // Never block startup on a failed stamp.
  }
  return from
}
