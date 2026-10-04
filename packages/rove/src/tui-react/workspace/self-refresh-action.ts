/**
 * "Refresh Rove" — behind the DAEMON OUT OF DATE banner's chord and the
 * Settings dev row. After `rove update` the daemon is new and the TUI old; this
 * restarts whichever halves are behind onto the installed build.
 *
 * React-free so the decision is testable; {@link relaunchSelf} replaces the
 * process, so it's injected and everything testable happens before it.
 *
 * Consent lives here, not in the keybinding: this tears down the visible UI and
 * a stray chord mustn't. Engine sessions are safe — they belong to the PTY host,
 * which outlives daemon and TUI — and the confirm says so.
 */

import { type SelfRefreshInputs, planSelfRefresh, relaunchSelf } from "../../cli/self-relaunch"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"

export type { SelfRefreshInputs } from "../../cli/self-relaunch"

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
 * Resolves false when nothing happened (declined, nothing to refresh, install
 * gone); never resolves on the accepted path — the process is replaced.
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
  // Stop the daemon BEFORE relaunching: nothing queued for "later" survives the
  // replace. The successor's first connect spawns the daemon on the new build.
  if (plan.restartDaemon) await deps.orchestrator.restartDaemon()
  // Explicit `never` annotation: TS only treats a call as terminating when the
  // callee has an explicit `never` return type; otherwise this function could
  // fall off its end without returning a boolean.
  const relaunch: (opts: { renderer: { destroy(): void } | null | undefined; notice: string }) => never =
    deps.relaunch ?? relaunchSelf
  relaunch({ renderer: deps.renderer, notice: deps.t("update.refresh.relaunching") })
}
