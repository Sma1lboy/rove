/**
 * Exit path for a deferred prompt (issue #78 B-layer, hard constraint #1+#3).
 *
 * Opening a `prompt_deferred` inbox item jumps to the tab AND inserts the
 * queued message — one action, reusing the existing open action (no new
 * chord). The insert RE-RUNS the A/C delivery gate: the human may be typing
 * again at the moment they release the message, so an unconditional paste
 * would re-open the very bug this feature fixes. When the gate still blocks,
 * the message stays queued (episode + record untouched) and the caller toasts
 * "still queued"; on success the record and episode are resolved.
 */

import type { RemoteOrchestrator } from "../../client/remote-orchestrator.ts"
import { ComposerBusyError, deliverToHostedKey, openHostedSessionHost } from "../../engine/hosted-session.ts"
import { engineEntry } from "../../engine/registry.ts"
import type { EngineScreenManifest } from "../../engine/screen-state.ts"
import type { VendorId } from "../../types/vendor.ts"

export type DeferredInsertOutcome =
  /** Pasted + submitted; the record and episode are resolved. */
  | "inserted"
  /** The A/C gate still blocks (human typing / composer non-empty); kept queued. */
  | "deferred-again"
  /** No reachable hosted session for the tab; kept queued for a later retry. */
  | "unavailable"

export async function insertDeferredPrompt(args: {
  readonly orch: Pick<RemoteOrchestrator, "resolveDeferredPrompt">
  readonly taskId: string
  readonly tabId: string
  readonly prompt: string
  readonly deferredId: string
  readonly manifest?: EngineScreenManifest
}): Promise<DeferredInsertOutcome> {
  const host = await openHostedSessionHost()
  if (!host) return "unavailable"
  try {
    const key = `${args.taskId}::${args.tabId}`
    let delivered: boolean
    try {
      delivered = await deliverToHostedKey(host.rpc, key, args.prompt, { screenManifest: args.manifest })
    } catch (err) {
      if (err instanceof ComposerBusyError) return "deferred-again"
      throw err
    }
    if (!delivered) return "unavailable"
    await args.orch.resolveDeferredPrompt(args.deferredId)
    return "inserted"
  } finally {
    host.close()
  }
}

/** The composer-empty manifest for a task's vendor (undefined → C-layer skips,
 *  fail-open, A-layer still guards). */
export function deferredManifestFor(vendor: VendorId | undefined): EngineScreenManifest | undefined {
  return vendor ? engineEntry(vendor).screenManifest : undefined
}
