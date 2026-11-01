/**
 * The launch-time "this engine has no Rove skill" notice, shared by the TUI
 * and web: each engine is named once, ever, so declining is not re-asked on
 * every launch. Outdated copies are not named; the daemon refreshes them.
 */

import { type StateSnapshot, loadStateFile, patchStateFile } from "../state/store.ts"
import { type SkillTarget, skillTargets } from "./skill-install.ts"

export const SKILL_NUDGED_KEY = "skill.nudged"

/** Engines lacking the skill that have not been named yet. Pure. */
export function skillNudgeTargets(targets: readonly SkillTarget[], state: StateSnapshot): SkillTarget[] {
  const raw = state[SKILL_NUDGED_KEY]
  const told = Array.isArray(raw) ? raw : []
  return targets.filter((target) => target.state === "not-installed" && !told.includes(target.vendor))
}

/**
 * Decide and stamp at once (like `takeWhatsNew`). Display names to show, or
 * null. Best-effort: a read-only state file only means the notice repeats.
 */
export function takeSkillNudge(): string[] | null {
  const state = loadStateFile()
  const fresh = skillNudgeTargets(skillTargets(), state)
  if (fresh.length === 0) return null
  const told = Array.isArray(state[SKILL_NUDGED_KEY]) ? (state[SKILL_NUDGED_KEY] as unknown[]) : []
  try {
    patchStateFile({ [SKILL_NUDGED_KEY]: [...told, ...fresh.map((t) => t.vendor)] })
  } catch {
    // Never block startup on a failed stamp.
  }
  return fresh.map((t) => t.displayName)
}
