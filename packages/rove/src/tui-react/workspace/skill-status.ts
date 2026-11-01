/**
 * Which engines set up on this machine still lack the Rove agent skill, for
 * the workspace's persistent skill banner. Started by `tui/index.tsx`, never by
 * a mount: a render-track mount must not read the operator's real engine homes,
 * so without {@link startSkillStatus} the list stays empty and no banner shows.
 */

import { createStateCell } from "../../lib/external-store"
import { installSkillErrors, skillTargets } from "../../lib/skill-install"

/** Display names of engines with no skill copy. Outdated copies don't count: the daemon refreshes them. */
export const skillMissing = createStateCell<readonly string[]>([])

const POLL_MS = 30_000
let started = false

export function refreshSkillStatus(): void {
  if (!started) return
  try {
    const next = skillTargets()
      .filter((t) => t.state === "not-installed")
      .map((t) => t.displayName)
    // A fresh array every poll would re-render the host every 30 s.
    if (next.join("\n") !== skillMissing.get().join("\n")) skillMissing.set(next)
  } catch {
    // An unreadable engine home keeps the last answer.
  }
}

/** Read now and every 30 s, so a `rove skill install` from a shell clears the banner too. */
export function startSkillStatus(): void {
  if (started) return
  started = true
  refreshSkillStatus()
  setInterval(refreshSkillStatus, POLL_MS).unref?.()
}

/** The banner's action. Returns the failure line, or null. */
export function installSkillNow(): string | null {
  const error = installSkillErrors()
  refreshSkillStatus()
  return error
}
