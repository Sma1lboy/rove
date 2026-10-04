/**
 * First-run welcome: decides, before the TUI boots, whether this launch owes
 * the once-ever greeting. Never fires alongside What's New, which needs a stamp
 * from an older build; this needs no stamp at all.
 *
 * ORDERING: {@link takeWelcome} must run BEFORE `enforceResetGate()`, which
 * writes `app.lastRunVersion` — read after it, every upgrade would be greeted.
 */

import { type StateSnapshot, loadStateFile, patchStateFile } from "../state/store.ts"
import type { ShellKind } from "./completion-scripts.ts"
import { detectShell } from "./onboarding.ts"
import { LAST_RUN_VERSION_KEY } from "./reset-gate.ts"

/** Set once the welcome dialog has been HANDED to the workspace, never unset. */
const WELCOMED_KEY = "welcomed"

/**
 * The skill install the user asked for. `npx` needs a plain terminal, so
 * `cli/index.ts` runs it after `startTui()` returns rather than under the TUI.
 */
export const PENDING_SKILL_KEY = "welcomePendingSkillInstall"

/** What the workspace needs to render the welcome dialog. */
export interface WelcomeRequest {
  /** Null when `$SHELL` is one we generate no completions for; the dialog then skips that question. */
  readonly shell: ShellKind | null
}

/**
 * `welcomed` covers users greeted once; `app.lastRunVersion` (written on every
 * start) covers users from before that key existed.
 */
export function shouldWelcome(state: StateSnapshot): boolean {
  if (state[WELCOMED_KEY] === true) return false
  return typeof state[LAST_RUN_VERSION_KEY] !== "string"
}

/**
 * Decide and stamp in one step, before the dialog renders, so a crash or a
 * killed session never re-asks. The write is best-effort: a read-only
 * filesystem must not block startup.
 */
export function takeWelcome(): WelcomeRequest | null {
  if (!shouldWelcome(loadStateFile())) return null
  try {
    patchStateFile({ [WELCOMED_KEY]: true })
  } catch {
    // Never block startup on a failed stamp.
  }
  return { shell: detectShell() }
}
