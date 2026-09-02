/**
 * Deferred-prompt RPC handlers. The delivery gate ran in a
 * kobe (CLI) process and found the target composer busy; it calls
 * `deferredPrompt.file` to hand ownership to the daemon, which stores the text
 * and records a `prompt_deferred` inbox episode. Release and bulk flush both
 * claim the record, persist a no-redelivery marker, then attempt exact-tab
 * delivery and clean up the Inbox pointer.
 */

import {
  type DeferredPromptClaim,
  DeferredPromptPendingError,
  type DeferredPromptRecord,
} from "./deferred-prompts-store.ts"
import { optionalString, requireString } from "./handler-validators.ts"
import type { DaemonHandlerContext, DaemonRequestHandler } from "./handlers.ts"

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
  const senderLabel = optionalString(payload, "senderLabel")
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
  await ctx.inbox.recordPromptDeferred(record.taskId, record.tabId, record.id, record.layer)
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
  const listed = await ctx.deferredPrompts.list()
  for (const expired of listed.expired) {
    const claimed = await ctx.deferredPrompts.claim(expired.id)
    if (claimed.kind !== "claimed") {
      report.cleanupPending.push({
        id: expired.id,
        taskId: expired.taskId,
        tabId: expired.tabId,
        error: claimed.kind,
      })
      continue
    }
    try {
      await deleteDeferredInboxPointer(expired, ctx)
      await ctx.deferredPrompts.completeClaim(claimed.claim)
      report.expired.push(expired.id)
    } catch (error) {
      await ctx.deferredPrompts.releaseClaim(claimed.claim).catch(() => {})
      report.cleanupPending.push({
        id: expired.id,
        taskId: expired.taskId,
        tabId: expired.tabId,
        error: errorText(error),
      })
    }
  }
  for (const record of listed.records) {
    if (record.deliveredAt || record.deliveryStartedAt) {
      const claimed = await ctx.deferredPrompts.claim(record.id)
      if (claimed.kind === "claimed") await cleanupDeliveredClaim(claimed.claim, ctx, report)
      continue
    }
    if (ctx.runtime.composerGateEnabled()) {
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

export const DEFERRED_PROMPT_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    // Socket-only (see deferredPrompt.get) — not on the pinned web allowlist.
    name: "deferredPrompt.file",
    async handle(payload, ctx) {
      const result = await fileWithInbox(deferredPromptInput(payload), ctx)
      if (result.kind === "occupied") throw new DeferredPromptPendingError(result.record)
      return { id: result.record.id }
    },
  },
  {
    // New clients use a distinct verb so an old daemon cannot silently route
    // them through its replace-the-existing-record implementation.
    name: "deferredPrompt.fileIfVacant",
    async handle(payload, ctx) {
      const result = await fileWithInbox(deferredPromptInput(payload), ctx)
      return {
        kind: result.kind,
        id: result.record.id,
        ...(result.kind === "occupied" ? { layer: result.record.layer } : {}),
      }
    },
  },
  {
    // Socket-only: the exit path is the TUI inbox (a socket client). Keeping
    // these off the web allowlist is deliberate — the browser-reachable surface
    // is a pinned security contract (test/daemon/web-exposure.test.ts).
    name: "deferredPrompt.get",
    async handle() {
      // A pre-claim client can race the daemon flusher after reading the text
      // and paste the same record twice. Fail that mixed-version exit path
      // loud; current clients use the atomic `release` verb below.
      throw new Error("legacy deferred prompt release is unsafe; restart Rove to update the client")
    },
  },
  {
    name: "deferredPrompt.resolve",
    async handle(payload, ctx) {
      const id = requireString(payload, "id")
      if (!ctx.deferredPrompts) throw new Error("deferred prompt store unavailable")
      // A legacy client can still finish an insert fetched before a daemon
      // restart. Claim before trusting its resolve so it cannot erase a
      // record that a concurrent flush owns.
      const claimed = await ctx.deferredPrompts.claim(id)
      if (claimed.kind !== "claimed") return { removed: false, kind: claimed.kind }
      const report: DeliveryReport = { delivered: [], cleaned: [], expired: [], retained: [], cleanupPending: [] }
      await ctx.deferredPrompts.markDelivered(claimed.claim)
      await cleanupDeliveredClaim(claimed.claim, ctx, report)
      return { removed: report.cleaned.includes(id), cleanupPending: report.cleanupPending }
    },
  },
  {
    name: "deferredPrompt.release",
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
    async handle(_payload, ctx) {
      return await flushDeferredPrompts(ctx)
    },
  },
]
