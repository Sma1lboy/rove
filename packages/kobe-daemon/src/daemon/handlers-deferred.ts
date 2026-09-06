/**
 * Deferred-prompt RPC handlers. The delivery gate ran in a
 * kobe (CLI) process and found the target composer busy; it calls
 * `deferredPrompt.fileIfVacant` to hand ownership to the daemon, which stores
 * the text and records a `prompt_deferred` inbox episode. Release and bulk flush
 * both claim the record, persist a no-redelivery marker, then attempt exact-tab
 * delivery and clean up the Inbox pointer.
 */

import { deferredPromptSender } from "./deferred-prompt-sender.ts"
import { sweepExpiredDeferredPrompts } from "./deferred-prompt-sweep.ts"
import {
  DEFERRED_PROMPT_TTL_MS,
  type DeferredPromptClaim,
  DeferredPromptPendingError,
  type DeferredPromptRecord,
} from "./deferred-prompts-store.ts"
import { optionalString, requireString } from "./handler-validators.ts"
import type { DaemonHandlerContext, DaemonRequestHandler } from "./handlers.ts"
import type { DaemonRequestName } from "./protocol.ts"

type DeferredPromptInput = Omit<DeferredPromptRecord, "id" | "at"> & {
  readonly at: number
}

function deferredPromptInput(payload: Record<string, unknown>): DeferredPromptInput {
  const taskId = requireString(payload, "taskId")
  const tabId = requireString(payload, "tabId")
  const prompt = requireString(payload, "prompt")
  const layer = requireString(payload, "layer")
  if (layer !== "recent-human-write" && layer !== "composer-not-empty") {
    throw new Error('layer must be "recent-human-write" or "composer-not-empty"')
  }
  // A peer send carries its provenance in the prompt's own header and passes
  // no `senderLabel`. Lifting it HERE is what puts a name on the Inbox card
  // and in `deferred-list`: the episode never sees the prompt body.
  const senderLabel = optionalString(payload, "senderLabel") ?? deferredPromptSender(prompt)
  const senderTaskId = optionalString(payload, "senderTaskId")
  return {
    taskId,
    tabId,
    prompt,
    layer,
    ...(senderLabel !== undefined ? { senderLabel } : {}),
    ...(senderTaskId !== undefined ? { senderTaskId } : {}),
    at: Date.now(),
  }
}

async function fileWithInbox(
  input: DeferredPromptInput,
  ctx: DaemonHandlerContext,
): Promise<{
  readonly kind: "filed" | "occupied"
  readonly record: DeferredPromptRecord
}> {
  if (!ctx.orch.getTask(input.taskId)) throw new Error(`task not found: ${input.taskId}`)
  if (!ctx.deferredPrompts) throw new Error("deferred prompt store unavailable")
  let kind: "filed" | "occupied" = "filed"
  let record: DeferredPromptRecord
  try {
    record = await ctx.deferredPrompts.file(input)
  } catch (error) {
    if (!(error instanceof DeferredPromptPendingError)) throw error
    kind = "occupied"
    record = error.existing
  }
  // This commit is intentionally retried for an occupied slot. A daemon can
  // die after the deferred record rename but before the Inbox rename; the
  // next filing reconstructs the pointer instead of stranding the text.
  await ctx.inbox.recordPromptDeferred(
    record.taskId,
    record.tabId,
    record.id,
    record.layer,
    record.at + DEFERRED_PROMPT_TTL_MS,
    record.senderLabel,
  )
  return { kind, record }
}

type FlushRetained =
  | {
      readonly id: string
      readonly taskId: string
      readonly tabId: string
      readonly reason: "unavailable"
    }
  | {
      readonly id: string
      readonly taskId: string
      readonly tabId: string
      readonly reason: "busy"
      readonly layer: "recent-human-write" | "composer-not-empty"
    }
  | {
      readonly id: string
      readonly taskId: string
      readonly tabId: string
      readonly reason: "error"
      readonly error: string
    }
  | {
      readonly id: string
      readonly taskId: string
      readonly tabId: string
      readonly reason: "in-flight"
    }
  | {
      readonly id: string
      readonly taskId: string
      readonly tabId: string
      readonly reason: "gate-enabled"
    }

interface DeliveryReport {
  delivered: string[]
  cleaned: string[]
  expired: string[]
  retained: FlushRetained[]
  cleanupPending: Array<{
    id: string
    taskId: string
    tabId: string
    error: string
  }>
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * One record as an API caller sees it. `at`/`expiresAt` are ISO strings (the
 * shape every other timestamp on the API wears) and `expiresAt` is derived
 * rather than stored — the TTL is a daemon constant, so publishing the
 * deadline is the only way a caller can know its text has a shelf life at all.
 * The claim/delivery bookkeeping (`deliveredAt`, `deliveryStartedAt`) stays
 * internal: it describes a transaction in flight, not the caller's message.
 */
function publicRecord(record: DeferredPromptRecord): {
  id: string
  taskId: string
  tabId: string
  prompt: string
  layer: string
  at: string
  expiresAt: string
  senderLabel?: string
  senderTaskId?: string
  dismissedAt?: string
} {
  return {
    id: record.id,
    taskId: record.taskId,
    tabId: record.tabId,
    prompt: record.prompt,
    layer: record.layer,
    at: new Date(record.at).toISOString(),
    expiresAt: new Date(record.at + DEFERRED_PROMPT_TTL_MS).toISOString(),
    ...(record.senderLabel !== undefined ? { senderLabel: record.senderLabel } : {}),
    ...(record.senderTaskId !== undefined ? { senderTaskId: record.senderTaskId } : {}),
    ...(record.dismissedAt !== undefined ? { dismissedAt: new Date(record.dismissedAt).toISOString() } : {}),
  }
}

async function deleteDeferredInboxPointer(record: DeferredPromptRecord, ctx: DaemonHandlerContext): Promise<void> {
  await ctx.inbox.deleteEpisode(record.taskId, record.tabId, undefined, "prompt_deferred", record.id)
}

async function cleanupDeliveredClaim(
  claim: DeferredPromptClaim,
  ctx: DaemonHandlerContext,
  report: DeliveryReport,
): Promise<void> {
  if (!ctx.deferredPrompts) throw new Error("deferred prompt store unavailable")
  const { record } = claim
  try {
    await deleteDeferredInboxPointer(record, ctx)
    await ctx.deferredPrompts.completeClaim(claim)
    report.cleaned.push(record.id)
  } catch (error) {
    await ctx.deferredPrompts.releaseClaim(claim)
    report.cleanupPending.push({
      id: record.id,
      taskId: record.taskId,
      tabId: record.tabId,
      error: errorText(error),
    })
  }
}

async function deliverClaim(
  claim: DeferredPromptClaim,
  ctx: DaemonHandlerContext,
  report: DeliveryReport,
): Promise<void> {
  if (!ctx.deferredPrompts) throw new Error("deferred prompt store unavailable")
  const { record } = claim
  if (record.deliveredAt || record.deliveryStartedAt) {
    await cleanupDeliveredClaim(claim, ctx, report)
    return
  }
  const task = ctx.orch.getTask(record.taskId)
  if (!task?.worktreePath) {
    await ctx.deferredPrompts.releaseClaim(claim)
    report.retained.push({
      id: record.id,
      taskId: record.taskId,
      tabId: record.tabId,
      reason: "unavailable",
    })
    return
  }
  let deliveryStarted = false
  try {
    await ctx.deferredPrompts.beginDelivery(claim)
    deliveryStarted = true
    const outcome = await ctx.runtime.deliverPromptToLiveEngineTabDetailed(
      {
        id: task.id,
        tabId: record.tabId,
        vendor: task.vendor,
        command: task.command,
        worktreePath: task.worktreePath,
      },
      record.prompt,
    )
    if (outcome.outcome === "delivered") {
      await ctx.deferredPrompts.markDelivered(claim)
      report.delivered.push(record.id)
      await cleanupDeliveredClaim(claim, ctx, report)
    } else {
      await ctx.deferredPrompts.resetDelivery(claim)
      await ctx.deferredPrompts.releaseClaim(claim)
      report.retained.push(
        outcome.outcome === "busy"
          ? {
              id: record.id,
              taskId: record.taskId,
              tabId: record.tabId,
              reason: "busy",
              layer: outcome.layer,
            }
          : {
              id: record.id,
              taskId: record.taskId,
              tabId: record.tabId,
              reason: "unavailable",
            },
      )
    }
  } catch (error) {
    await ctx.deferredPrompts.releaseClaim(claim).catch(() => {})
    if (deliveryStarted) {
      report.cleanupPending.push({
        id: record.id,
        taskId: record.taskId,
        tabId: record.tabId,
        error: errorText(error),
      })
    } else {
      report.retained.push({
        id: record.id,
        taskId: record.taskId,
        tabId: record.tabId,
        reason: "error",
        error: errorText(error),
      })
    }
  }
}

async function flushDeferredPrompts(ctx: DaemonHandlerContext): Promise<{
  delivered: string[]
  cleaned: string[]
  expired: string[]
  retained: FlushRetained[]
  cleanupPending: DeliveryReport["cleanupPending"]
}> {
  if (!ctx.deferredPrompts) throw new Error("deferred prompt store unavailable")
  const report: DeliveryReport = {
    delivered: [],
    cleaned: [],
    expired: [],
    retained: [],
    cleanupPending: [],
  }
  // Expiry is the timer's job too (deferred-prompt-sweep.ts), so it lives
  // there and both callers share one implementation. `list()` reports the
  // expired set and drops it from `records`, so the loop below sees only the
  // live half either way.
  const swept = await sweepExpiredDeferredPrompts({ store: ctx.deferredPrompts, inbox: ctx.inbox })
  report.expired.push(...swept.expired)
  report.cleanupPending.push(...swept.cleanupPending)
  const listed = await ctx.deferredPrompts.list()
  for (const record of listed.records) {
    if (record.deliveredAt || record.deliveryStartedAt) {
      const claimed = await ctx.deferredPrompts.claim(record.id)
      if (claimed.kind === "claimed") await cleanupDeliveredClaim(claimed.claim, ctx, report)
      continue
    }
    if (ctx.runtime.deliveryGuard() === "on") {
      report.retained.push({
        id: record.id,
        taskId: record.taskId,
        tabId: record.tabId,
        reason: "gate-enabled",
      })
      continue
    }
    const claimed = await ctx.deferredPrompts.claim(record.id)
    if (claimed.kind === "in-flight") {
      report.retained.push({
        id: record.id,
        taskId: record.taskId,
        tabId: record.tabId,
        reason: "in-flight",
      })
      continue
    }
    if (claimed.kind === "claimed") await deliverClaim(claimed.claim, ctx, report)
  }
  return report
}

/**
 * `deferredPrompt.file` / `.get` / `.resolve` did real work once; nothing
 * calls them now. They stay in the registry as REFUSALS rather than being
 * deleted outright, because dropping a name is not a neutral act here: the
 * only caller left is a client OLDER than this daemon — a pre-`fileIfVacant`
 * CLI still filing through `.file`, or a TUI that read a record with `.get`
 * before the daemon restarted under it — and the registry's generic
 * `unknown daemon request: …` sends exactly that caller the wrong way. Every
 * client maps that string to `DAEMON_VERSION_SKEW`, whose recovery is
 * "restart the daemon"; the daemon is the current half, so restarting it
 * changes nothing and the skew survives the fix.
 *
 * The recovery therefore has to ride the MESSAGE. An old client shapes errors
 * with its own frozen code, so a structured `hint`/`nextCommandArgs` added on
 * this end never reaches it; the `CODE: ` prefix is the one structured field a
 * daemon error carries across the wire at all (`splitDaemonCode` in
 * `cli/api/types.ts`), and the prose after it is what a human or an agent
 * actually reads.
 *
 * `.get`/`.resolve` are refusals for a second reason that predates this: a
 * pre-claim client can race the daemon flusher after reading the text and
 * paste the same record twice. `.get` already threw for that. Restoring the
 * verb restores the refusal, never the read.
 */
function retiredDeferredPromptRpc(name: DaemonRequestName, replacement: string): DaemonRequestHandler {
  return {
    name,
    handle() {
      throw new Error(
        `RETIRED_RPC: ${name} is gone; use ${replacement}. This client is an older build than the daemon — restart Rove to update the client (restarting the daemon will not help).`,
      )
    },
  }
}

export const DEFERRED_PROMPT_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    // Socket-only: not on the pinned web allowlist. Keeping the file/release
    // verbs off the browser-reachable surface is a security contract
    // (test/daemon/web-exposure.test.ts).
    //
    // The distinct name is load-bearing: an old daemon rejects it outright
    // rather than silently routing the prompt through the retired
    // replace-the-existing-record verb.
    name: "deferredPrompt.fileIfVacant",
    async handle(payload, ctx) {
      const result = await fileWithInbox(deferredPromptInput(payload), ctx)
      return {
        kind: result.kind,
        id: result.record.id,
        // The sender's `deferred` payload is the only place it learns the
        // text has a deadline at all; an older CLI just ignores the field.
        expiresAt: publicRecord(result.record).expiresAt,
        ...(result.kind === "occupied" ? { layer: result.record.layer } : {}),
      }
    },
  },
  {
    // The read half of the TUI Inbox, for a caller with no screen. Reports the
    // LIVE records only — `store.list()` already separates the TTL-expired
    // set, which the sweep timer owns — plus each record's `expiresAt`, so a
    // headless sender can see how long the daemon will hold its text.
    name: "deferredPrompt.list",
    async handle(payload, ctx) {
      if (!ctx.deferredPrompts) throw new Error("deferred prompt store unavailable")
      const listed = await ctx.deferredPrompts.list()
      // Dismissed text is retained but not queued, so it is opt-in: a caller
      // asking "what is waiting?" must not see it, and a caller undoing a
      // dismiss must be able to find it.
      const records = payload.includeDismissed === true ? [...listed.records, ...listed.dismissed] : listed.records
      return { records: records.map(publicRecord) }
    },
  },
  {
    // The Inbox's dismiss action: take the message off the queue and delete
    // its Inbox pointer without delivering. This unblocks a tab whose deferred
    // slot is occupied (`DEFERRED_PROMPT_PENDING`). The TEXT is kept until the
    // record's ordinary 24h expiry — a mis-hit `d` on a card that said only
    // "message queued" used to destroy a dispatcher's instruction outright.
    name: "deferredPrompt.dismiss",
    async handle(payload, ctx) {
      const id = requireString(payload, "id")
      if (!ctx.deferredPrompts) throw new Error("deferred prompt store unavailable")
      const dropped = await ctx.deferredPrompts.discard(id, "Inbox item dismissed")
      if (!dropped) return { dismissed: false }
      await deleteDeferredInboxPointer(dropped, ctx)
      return { dismissed: true, record: publicRecord(dropped) }
    },
  },
  {
    name: "deferredPrompt.release",
    blocking: true,
    async handle(payload, ctx) {
      const id = requireString(payload, "id")
      if (!ctx.deferredPrompts) throw new Error("deferred prompt store unavailable")
      const report: DeliveryReport = {
        delivered: [],
        cleaned: [],
        expired: [],
        retained: [],
        cleanupPending: [],
      }
      const claimed = await ctx.deferredPrompts.claim(id)
      if (claimed.kind === "claimed") await deliverClaim(claimed.claim, ctx, report)
      return { kind: claimed.kind, ...report }
    },
  },
  {
    name: "deferredPrompt.discardTab",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const tabId = requireString(payload, "tabId")
      if (!ctx.deferredPrompts) throw new Error("deferred prompt store unavailable")
      const dropped = await ctx.deferredPrompts.discardTab(taskId, tabId, "tab closed")
      for (const record of dropped) await deleteDeferredInboxPointer(record, ctx)
      return { dropped: dropped.map((record) => record.id) }
    },
  },
  {
    name: "deferredPrompt.flush",
    blocking: true,
    async handle(_payload, ctx) {
      return await flushDeferredPrompts(ctx)
    },
  },
  retiredDeferredPromptRpc("deferredPrompt.file", "deferredPrompt.fileIfVacant"),
  retiredDeferredPromptRpc("deferredPrompt.get", "deferredPrompt.release"),
  retiredDeferredPromptRpc("deferredPrompt.resolve", "deferredPrompt.release"),
]
