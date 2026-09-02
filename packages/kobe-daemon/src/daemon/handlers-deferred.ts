/**
 * Deferred-prompt RPC handlers (issue #78 B-layer). The delivery gate ran in a
 * kobe (CLI) process and found the target composer busy; it calls
 * `deferredPrompt.file` to hand ownership to the daemon, which stores the text
 * and records a `prompt_deferred` inbox episode. The exit path reads the text
 * back (`get`), inserts it with a fresh A/C gate, then releases it (`resolve`).
 */

import { DeferredPromptPendingError, type DeferredPromptRecord } from "./deferred-prompts-store.ts"
import { optionalString, requireString } from "./handler-validators.ts"
import type { DaemonHandlerContext, DaemonRequestHandler } from "./handlers.ts"

type DeferredPromptInput = Omit<DeferredPromptRecord, "id" | "at"> & { readonly at: number }

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
): Promise<{ readonly kind: "filed" | "occupied"; readonly record: DeferredPromptRecord }> {
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
    async handle(payload, ctx) {
      const id = requireString(payload, "id")
      if (!ctx.deferredPrompts) throw new Error("deferred prompt store unavailable")
      const record = await ctx.deferredPrompts.get(id)
      return { record }
    },
  },
  {
    name: "deferredPrompt.resolve",
    async handle(payload, ctx) {
      const id = requireString(payload, "id")
      if (!ctx.deferredPrompts) throw new Error("deferred prompt store unavailable")
      // Resolve means BOTH halves: the stored text AND the inbox episode that
      // points at it. Read the record first (for its task/tab) so the episode
      // can be dropped even though the record is about to go.
      const record = await ctx.deferredPrompts.get(id)
      const removed = await ctx.deferredPrompts.resolve(id)
      if (record) await ctx.inbox.deleteEpisode(record.taskId, record.tabId)
      return { removed }
    },
  },
]
