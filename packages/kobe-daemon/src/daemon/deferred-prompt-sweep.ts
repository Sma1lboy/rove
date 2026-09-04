/**
 * Expiry sweep for the deferred-prompt store.
 *
 * `DEFERRED_PROMPT_TTL_MS` is the store's stated retention policy, but nothing
 * enforced it: `list()` is the only method that computes `expired`, and its
 * only caller was `deferredPrompt.flush`, which fires when a human opens
 * Settings and toggles the composer gate. A prompt the delivery gate parked
 * because a composer was busy therefore sat on disk indefinitely, with a
 * permanent `prompt_deferred` Inbox row that no later turn on that tab could
 * clear (`attentionInboxItemKey` gives the deferred episode its own lane, so
 * the `turn-start` branch never deletes it).
 *
 * This module supplies the missing drainer: the same coordinated record +
 * Inbox cleanup, driven by a boot pass and a timer instead of a human.
 *
 * It expires ONLY. Do not fold the live-record delivery retry in here —
 * `flushDeferredPrompts` re-attempts delivery for every non-expired record,
 * and that is a deliberate human-triggered action (the gate just turned off).
 */

import type { AttentionInboxStore } from "./attention-inbox.ts"
import { logDaemonError } from "./crash-log.ts"
import type { DeferredPromptRecord, DeferredPromptsStore } from "./deferred-prompts-store.ts"
import { startTicker } from "./ticker.ts"

/** Once an hour is plenty for a 24h boundary, and a tick is one file read. */
export const DEFAULT_DEFERRED_SWEEP_TICK_MS = 60 * 60 * 1000

export interface DeferredSweepDeps {
  readonly store: DeferredPromptsStore
  readonly inbox: Pick<AttentionInboxStore, "recordPromptExpired">
  readonly now?: () => number
}

export interface DeferredSweepFailure {
  readonly id: string
  readonly taskId: string
  readonly tabId: string
  readonly error: string
}

export interface DeferredSweepReport {
  readonly expired: string[]
  readonly cleanupPending: DeferredSweepFailure[]
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Drop every past-TTL record and turn its Inbox pointer into the notice that
 * the text was destroyed undelivered.
 *
 * The row is REPLACED, not deleted. `rove api send` exits 0 on a deferral and
 * documents it as a success, and the sender's session is typically gone a day
 * later — so deleting the row silently was the one outcome that guaranteed
 * nobody would ever learn the message never ran. The report this function
 * returns goes to `logDaemonInfo` and no further; the durable episode is what
 * a human actually meets.
 *
 * Order matters: the Inbox row goes first, then the claim completes. A record
 * whose pointer rewrite throws keeps its claim released and is reported as
 * `cleanupPending`, so the next pass retries it rather than leaving a row that
 * points at a record that is gone.
 */
export async function sweepExpiredDeferredPrompts(deps: DeferredSweepDeps): Promise<DeferredSweepReport> {
  const report: DeferredSweepReport = { expired: [], cleanupPending: [] }
  const listed = await deps.store.list()
  for (const expired of listed.expired) {
    const claimed = await deps.store.claim(expired.id)
    if (claimed.kind !== "claimed") {
      report.cleanupPending.push(failure(expired, claimed.kind))
      continue
    }
    try {
      await deps.inbox.recordPromptExpired(expired.taskId, expired.tabId, expired.id, (deps.now ?? Date.now)())
      await deps.store.completeClaim(claimed.claim)
      report.expired.push(expired.id)
    } catch (error) {
      await deps.store.releaseClaim(claimed.claim).catch(() => {})
      report.cleanupPending.push(failure(expired, errorText(error)))
    }
  }
  return report
}

function failure(record: DeferredPromptRecord, error: string): DeferredSweepFailure {
  return { id: record.id, taskId: record.taskId, tabId: record.tabId, error }
}

/**
 * Start the expiry sweep, with an immediate first pass.
 *
 * Deliberately NOT gated on `hasSubscribers`, for the same reason
 * `startQuotaResumeRunner` is not: expiring a record nobody is watching is the
 * entire point. The immediate pass is what makes a daemon restart clear
 * records that went stale while it was down.
 */
export function startDeferredPromptSweep(
  deps: DeferredSweepDeps,
  tickMs: number = DEFAULT_DEFERRED_SWEEP_TICK_MS,
): () => void {
  return startTicker({
    name: "deferred-prompt-sweep",
    tickMs,
    immediate: true,
    run: () => sweepExpiredDeferredPrompts(deps),
  })
}
