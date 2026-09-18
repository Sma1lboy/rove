/**
 * "What's new" gate — the once-per-upgrade first screen.
 *
 * `state.json` remembers which version's notes the user has already been
 * shown (`app.whatsNewSeenVersion`). A launch whose stamp is OLDER than the
 * running build opens the What's New page; every later launch on the same
 * build does not. A fresh install has no stamp at all and is shown nothing —
 * there is no "what changed" for someone who has never run an older build.
 *
 * ORDERING: {@link takeWhatsNew} must run BEFORE `enforceResetGate()`.
 * Installs that predate this key fall back to `app.lastRunVersion` so the
 * upgrade this ships in still gets its notes, and the reset gate rewrites
 * that stamp to the current version on its way past.
 */

import { type StateSnapshot, loadStateFile, patchStateFile } from "../state/store.ts"
import { CURRENT_VERSION, compareSemver } from "../version.ts"
import { LAST_RUN_VERSION_KEY } from "./reset-gate.ts"

export const WHATS_NEW_SEEN_KEY = "app.whatsNewSeenVersion"

/**
 * Pure decision: the version the user was last shown notes for, when this
 * launch should open What's New — otherwise null.
 *
 * Null covers three cases that all mean "say nothing": a fresh install (no
 * stamp of either kind), a relaunch on the same build, and a DOWNGRADE.
 * A downgrade has no forward range of releases to list, so the page would
 * render an empty changelog under a backwards header.
 */
export function whatsNewFromVersion(state: StateSnapshot, current: string = CURRENT_VERSION): string | null {
  const stamped = state[WHATS_NEW_SEEN_KEY] ?? state[LAST_RUN_VERSION_KEY]
  if (typeof stamped !== "string" || stamped.length === 0) return null
  return compareSemver(current, stamped) > 0 ? stamped : null
}

/**
 * Read the decision and stamp the current version in one go, so a crash
 * anywhere later in boot cannot turn the page into a recurring greeting.
 * Best-effort write, same rule as the reset gate: a read-only FS must not
 * stop the TUI from starting.
 */
export function takeWhatsNew(): string | null {
  const from = whatsNewFromVersion(loadStateFile())
  try {
    patchStateFile({ [WHATS_NEW_SEEN_KEY]: CURRENT_VERSION })
  } catch {
    // Never block startup on a failed stamp.
  }
  return from
}
