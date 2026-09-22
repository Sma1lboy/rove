/**
 * First-run welcome gate — the once-ever greeting, decided before the TUI boots.
 *
 * Sibling of `whats-new.ts` and deliberately its mirror: What's New answers
 * "you just crossed into a new build, here is what changed", this one answers
 * "you have never run this at all, here is what it is". The two are mutually
 * exclusive by construction — What's New needs a stamp from an OLDER build,
 * and this one only fires when no stamp of any kind exists — so a launch can
 * never owe the user both dialogs.
 *
 * ## Why this is not a wizard any more
 *
 * It shipped as an inline wizard that ran INSTEAD of the TUI: `rove` rendered
 * a footer, asked its questions, then exited, and the user had to type `rove`
 * a second time to reach the product. The first thing a new user got was a
 * form followed by their own shell prompt. It is now a modal over the real
 * workspace (`tui-react/onboarding/host.tsx`), for the reason
 * `whats-new-dialog.tsx` already worked out for its own surface: a page is
 * the right shape for something you navigate to and come back from, and this
 * is a single dismissal handed to you on boot — with the thing you actually
 * came for visible behind it.
 *
 * ORDERING: {@link takeWelcome} must run BEFORE `enforceResetGate()`, which
 * writes `app.lastRunVersion`. That stamp is how an existing user — onboarded
 * long before this key existed — is recognized as someone who must not be
 * greeted; reading it after the gate would greet every upgrade exactly once.
 */

import { type StateSnapshot, loadStateFile, patchStateFile } from "../state/store.ts"
import type { ShellKind } from "./completion-scripts.ts"
import { detectShell } from "./onboarding.ts"
import { LAST_RUN_VERSION_KEY } from "./reset-gate.ts"

/** Set once the welcome dialog has been HANDED to the workspace, never unset. */
export const WELCOMED_KEY = "welcomed"

/**
 * The skill install the user asked for, deferred until the TUI is gone.
 *
 * `npx` wants a real terminal — prompts, progress bars, its own line
 * discipline — and the TUI owns the screen while a dialog is open. Rather
 * than fight it (a PTY tab would work but drags the orchestrator into a
 * dialog that needs nothing else from it), the answer is recorded here and
 * `cli/index.ts` runs it after `startTui()` returns, when the terminal is
 * plain again and the output lands in scrollback where the user can read it.
 */
export const PENDING_SKILL_KEY = "welcomePendingSkillInstall"

/** What the workspace needs to render the welcome dialog. */
export interface WelcomeRequest {
  /**
   * The user's shell, or null when `$SHELL` names nothing we generate
   * completions for. Null drops the completions question entirely — there is
   * nothing to hook it into — so the dialog asks about the skill alone.
   */
  readonly shell: ShellKind | null
}

/**
 * Pure decision: does this launch owe the user a welcome?
 *
 * Two ways to say no, and they cover different people. `welcomed` is the
 * direct record that the dialog has been handed over once. `app.lastRunVersion`
 * covers everyone who onboarded before this key existed: it is written on
 * every successful start, so anyone who has ever reached the TUI is by
 * definition not a first-run user, and greeting them on upgrade would be a
 * regression dressed as a feature.
 */
export function shouldWelcome(state: StateSnapshot): boolean {
  if (state[WELCOMED_KEY] === true) return false
  return typeof state[LAST_RUN_VERSION_KEY] !== "string"
}

/**
 * Read the decision and stamp it in one go, so a crash later in boot cannot
 * turn the greeting into a recurring one. Best-effort write, same rule as
 * the reset gate and the What's New gate: a read-only filesystem must not
 * stop the TUI from starting.
 *
 * Stamping BEFORE the dialog renders (rather than when it resolves) is the
 * same never-nag rule the wizard had: a killed session must not re-ask. The
 * dialog is re-reachable on purpose — Settings → Engines is where its one
 * durable action lives, and the keyboard page points there.
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
