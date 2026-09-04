/**
 * Exit path for a deferred prompt.
 *
 * Opening a `prompt_deferred` inbox item jumps to the tab AND asks the daemon
 * to release the queued message — one action, reusing the existing open action
 * (no new chord). Release RE-RUNS the A/C delivery gate: the human may be typing
 * again at the moment they release the message, so an unconditional paste
 * would re-open the very bug this feature fixes. When the gate still blocks,
 * the message stays queued (episode + record untouched) and the caller toasts
 * "still queued". A daemon-side claim keeps release, flush, and dismiss from
 * delivering the same record concurrently.
 */

import type { RemoteOrchestrator } from "../../client/remote-orchestrator.ts"

export type DeferredInsertOutcome =
  /** Pasted + submitted; the record and episode are resolved. */
  | "inserted"
  /** The A/C gate still blocks (human typing / composer non-empty); kept queued. */
  | "deferred-again"
  /** No reachable hosted session for the tab; kept queued for a later retry. */
  | "unavailable"
  /** The record was already resolved or expired; caller should dismiss its stale Inbox pointer. */
  | "missing"

export async function insertDeferredPrompt(args: {
  readonly orch: Pick<RemoteOrchestrator, "releaseDeferredPrompt">
  readonly deferredId: string
}): Promise<DeferredInsertOutcome> {
  const outcome = await args.orch.releaseDeferredPrompt(args.deferredId)
  if (outcome === "inserted" || outcome === "deferred-again" || outcome === "unavailable") return outcome
  if (outcome === "in-flight") return "deferred-again"
  if (outcome === "missing") return "missing"
  throw new Error(`deferred prompt ${args.deferredId} was delivered but cleanup is still pending`)
}
