/**
 * "Refresh Rove" — the action behind the DAEMON OUT OF DATE banner's chord
 * and the Settings dev row.
 *
 * The whole point of the feature in one place: Rove ships several times a day,
 * so a user who ran `rove update` is left with a new daemon and an old TUI, and
 * until now the only cure was quitting and typing `rove` again. This restarts
 * whichever halves are behind and comes back on the installed build.
 *
 * React-free so the decision half can be unit-tested without a renderer. The
 * only thing that cannot be tested is the last line — {@link relaunchSelf}
 * genuinely replaces the process — so everything a test cares about happens
 * before it, and the relaunch itself arrives as an injected dependency.
 *
 * Consent is explicit and lives here rather than in the keybinding: this tears
 * down the visible UI, and an accidental chord should never do that. Engine
 * sessions are NOT at risk — they belong to the separate PTY host, which
 * outlives both the daemon and this process — and the confirm says so, because
 * "will I lose my running agents" is the only question a user actually has.
 */

import { type SelfRefreshInputs, planSelfRefresh, relaunchSelf } from "../../cli/self-relaunch"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"

export type { SelfRefreshInputs, SelfRefreshPlan } from "../../cli/self-relaunch"

export interface SelfRefreshDeps {
  readonly orchestrator: Pick<RemoteOrchestrator, "restartDaemon">
  /** Destroyed before the relaunch so the successor inherits a sane terminal. */
  readonly renderer: { destroy(): void } | null | undefined
  /** Resolves true when the user accepted. */
  readonly confirm: () => Promise<boolean>
  readonly notifyError: (message: string) => void
  readonly t: (key: string, params?: Record<string, string | number>) => string
  /** Seam for tests — the real one never returns. */
  readonly relaunch?: (opts: { renderer: { destroy(): void } | null | undefined; notice: string }) => never
}

/**
 * Run one refresh. Resolves false when nothing happened (declined, nothing to
 * refresh, or a gone install — the last two already have their own banner
 * copy, so this only reports the one the user cannot see coming). On the
 * accepted path it does not resolve at all: the process is replaced.
 */
export async function selfRefreshAction(deps: SelfRefreshDeps, inputs: SelfRefreshInputs): Promise<boolean> {
  const plan = planSelfRefresh(inputs)
  if (plan.kind === "unavailable") {
    deps.notifyError(deps.t("update.refresh.installGone"))
    return false
  }
  if (plan.kind === "current") {
    deps.notifyError(deps.t("update.refresh.alreadyCurrent"))
    return false
  }
  if (!(await deps.confirm())) return false
  // Stop the daemon BEFORE relaunching, never after: this process is about to
  // stop existing, so anything queued to happen "later" simply does not. The
  // successor spawns a daemon on its own first connect, which is what brings
  // the restarted one back — on the build that is on disk now.
  if (plan.restartDaemon) await deps.orchestrator.restartDaemon()
  // Annotated, not inferred: TypeScript only treats a call as terminating
  // control flow when the callee is a name with an EXPLICIT `never` return
  // type, and without that this function reads as one that can fall off its
  // end without returning a boolean.
  const relaunch: (opts: { renderer: { destroy(): void } | null | undefined; notice: string }) => never =
    deps.relaunch ?? relaunchSelf
  relaunch({ renderer: deps.renderer, notice: deps.t("update.refresh.relaunching") })
}
