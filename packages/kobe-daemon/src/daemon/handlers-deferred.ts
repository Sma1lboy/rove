/**
 * Deferred-prompt RPC handlers (issue #78 B-layer). The delivery gate ran in a
 * kobe (CLI) process and found the target composer busy; it calls
 * `deferredPrompt.file` to hand ownership to the daemon, which stores the text
 * and records a `prompt_deferred` inbox episode. The exit path reads the text
 * back (`get`), inserts it with a fresh A/C gate, then releases it (`resolve`).
 */

import { optionalString, requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"

export const DEFERRED_PROMPT_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    // Socket-only (see deferredPrompt.get) — not on the pinned web allowlist.
    name: "deferredPrompt.file",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const tabId = requireString(payload, "tabId")
      const prompt = requireString(payload, "prompt")
      const layer = requireString(payload, "layer")
      if (layer !== "recent-human-write" && layer !== "composer-not-empty") {
        throw new Error('layer must be "recent-human-write" or "composer-not-empty"')
      }
      if (!ctx.orch.getTask(taskId)) throw new Error(`task not found: ${taskId}`)
      if (!ctx.deferredPrompts) throw new Error("deferred prompt store unavailable")
      const senderLabel = optionalString(payload, "senderLabel")
      const senderTaskId = optionalString(payload, "senderTaskId")
      const record = await ctx.deferredPrompts.file({
        taskId,
        tabId,
        prompt,
        layer,
        ...(senderLabel !== undefined ? { senderLabel } : {}),
        ...(senderTaskId !== undefined ? { senderTaskId } : {}),
        at: Date.now(),
      })
      await ctx.inbox.recordPromptDeferred(taskId, tabId, record.id, layer)
      return { id: record.id }
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
