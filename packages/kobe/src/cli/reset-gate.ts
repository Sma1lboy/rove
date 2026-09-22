/**
 * Breaking-version reset gate: when the binary and `app.lastRunVersion` straddle
 * a {@link BREAKING_VERSIONS} entry, the TUI refuses to start until `kobe reset`
 * (tears down daemon/PTY host/sessions and re-stamps).
 *
 * NOT enforced for non-app subcommands (`update`, `doctor`, `reset`, `api`, …):
 * a gated install must stay inspectable and recoverable.
 */

import { loadStateFile, patchStateFile } from "../state/store.ts"
import { BREAKING_VERSIONS, CURRENT_VERSION, compareSemver } from "../version.ts"
import { activeCliName } from "./rename-compat.ts"

export const LAST_RUN_VERSION_KEY = "app.lastRunVersion"

/**
 * Breaking versions blocking a start. A missing stamp is a fresh (or pre-gate)
 * install: nothing blocks. Direction-agnostic, like {@link breakingVersionsCrossed}.
 */
export function resetGateBlockers(
  lastRun: unknown,
  current: string = CURRENT_VERSION,
  breaking: readonly string[] = BREAKING_VERSIONS,
): string[] {
  if (typeof lastRun !== "string" || lastRun.length === 0) return []
  const [lo, hi] = compareSemver(lastRun, current) <= 0 ? [lastRun, current] : [current, lastRun]
  return breaking.filter((b) => compareSemver(b, lo) > 0 && compareSemver(b, hi) <= 0)
}

/** exit(1) with instructions if blocked, else re-stamp (best-effort). */
export function enforceResetGate(): void {
  const cliName = activeCliName()
  const lastRun = loadStateFile()[LAST_RUN_VERSION_KEY]
  const blockers = resetGateBlockers(lastRun)
  if (blockers.length > 0) {
    const from = typeof lastRun === "string" ? lastRun : "unknown"
    console.error(
      [
        `${cliName} ${CURRENT_VERSION}: cannot start — version ${blockers.join(", ")} introduced breaking changes`,
        `(last run: ${from}). Your daemon/session state may be incompatible.`,
        "",
        "Run:",
        `  ${cliName} reset          # stop daemon + PTY host + sessions (tasks kept)`,
        `  ${cliName} reset --hard   # additionally wipe the task index + UI state`,
        "",
        "Then relaunch Rove. Worktrees are never touched.",
      ].join("\n"),
    )
    process.exit(1)
  }
  if (lastRun !== CURRENT_VERSION) stampResetGate()
}

/** Stamp the running version (also how `kobe reset` clears a block).
 *  Best-effort: a read-only FS must not crash startup. */
export function stampResetGate(): void {
  try {
    patchStateFile({ [LAST_RUN_VERSION_KEY]: CURRENT_VERSION })
  } catch {
    // Never block startup on a failed stamp — the gate just re-evaluates next run.
  }
}
