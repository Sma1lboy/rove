/**
 * UI broadcast/report RPC handlers, spread into the registry by `handlers.ts`,
 * whose wire contract (byte-equivalent payloads, key order load-bearing) moving
 * a handler between files must never change.
 */

import { randomUUID } from "node:crypto"
import { samePath } from "../path-identity.ts"
import { optionalBoolean, optionalString, requireNumber, requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"
import { displayTaskTitle } from "./protocol.ts"

/** `ui.prompt` timeout bounds — a plugin must not hang the CLI forever. */
const PROMPT_DEFAULT_TIMEOUT_MS = 120_000
const PROMPT_MAX_TIMEOUT_MS = 600_000
/** A live TUI acks in one render turn; bounded so a stale GUI can't hang a headless close. */
const TAB_CLOSE_TUI_TIMEOUT_MS = 750

export const UI_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "session.deliver",
    async handle(payload, ctx) {
      // `api dispatch` (docs/design/dispatcher.md). The daemon DELIVERS via the
      // PTY host, then falls back to the broadcast: no TUI subscribes to the
      // channel, so broadcast alone pastes nowhere for a TUI-hosted task.
      const taskId = requireString(payload, "taskId")
      const text = requireString(payload, "text")
      const tabId = optionalString(payload, "tabId")
      const source = optionalString(payload, "source")
      if (source !== undefined && source !== "note" && source !== "dispatcher") {
        throw new Error('source must be "note" or "dispatcher"')
      }
      const task = ctx.orch.getTask(taskId)
      if (!task) throw new Error(`task not found: ${taskId}`)
      // Neither adapter spawns: `dispatch` requires an already-hosted session.
      const outcome = task.worktreePath
        ? await (tabId === undefined
            ? ctx.runtime.deliverPromptToLiveEngineDetailed(
                { id: task.id, vendor: task.vendor, command: task.command, worktreePath: task.worktreePath },
                text,
              )
            : ctx.runtime.deliverPromptToLiveEngineTabDetailed(
                { id: task.id, tabId, vendor: task.vendor, command: task.command, worktreePath: task.worktreePath },
                text,
              )
          ).catch(() => ({ outcome: "no-session" }) as const)
        : ({ outcome: "no-session" } as const)
      // Only on `no-session`: the channel is the only way to reach a
      // browser-hosted session (SPA tab ids are invisible to the PTY host),
      // but after a successful paste it would make a browser paste twice.
      const broadcast = outcome.outcome === "no-session"
      if (broadcast) {
        ctx.bus.publish("session.deliver", {
          taskId,
          text,
          ...(tabId !== undefined ? { tabId } : {}),
          at: Date.now(),
          source: source ?? "dispatcher",
        })
      }
      ctx.plugins?.handleUiReport({
        kind: "message.delivered",
        taskId,
        detail: {
          source: source ?? "dispatcher",
          ...(tabId !== undefined ? { tabId } : {}),
          length: text.length,
          clients: ctx.daemon.clientCount(),
        },
      })
      // `delivered` is OBSERVED: true only when a paste landed in a live
      // engine. `reason: "broadcast"` is unconfirmable; `clients` (CONNECTION
      // count, calling CLI included) is the only reach signal, and 0 proves
      // the text reached nobody.
      if (outcome.outcome === "delivered") {
        return { ok: true, delivered: true, tabId: outcome.tabId, clients: ctx.daemon.clientCount() }
      }
      // keepAlive `exec`ed a login shell where the engine exited: the text
      // would be RUN, not read. Nothing was written or broadcast.
      if (outcome.outcome === "no-engine") {
        return {
          ok: true,
          delivered: false,
          reason: "no-engine",
          tabId: outcome.tabId,
          clients: ctx.daemon.clientCount(),
        }
      }
      return { ok: true, delivered: false, reason: "broadcast", clients: ctx.daemon.clientCount() }
    },
  },
  {
    name: "ui.reportEvent",
    async handle(payload, ctx) {
      // Fire-and-forget: the TUI reports a UI moment; plugins are the only
      // consumer (same no-broadcast rationale as engine lifecycle kinds).
      const kind = requireString(payload, "kind")
      if (!kind.match(/^(file\.(will-open|opened|closed)|task\.opened|project\.opened|tab\.(opened|closed))$/)) {
        throw new Error(`unknown ui event kind: ${kind}`)
      }
      const taskId = optionalString(payload, "taskId")
      const detail = payload.detail
      const eventDetail =
        detail && typeof detail === "object" && !Array.isArray(detail) ? (detail as Record<string, unknown>) : undefined
      // Every close (TUI's own and `terminalTab.close`) funnels through here,
      // so sweep the activity ledger without a second hook on the close broker.
      if (kind === "tab.closed" && taskId) {
        const closedTabId = eventDetail?.tabId
        if (typeof closedTabId === "string" && closedTabId) {
          ctx.activity.clearTab(taskId, closedTabId)
          // Its image ids can never be written to again.
          ctx.graphics?.clearTab(taskId, closedTabId)
        }
      }
      ctx.plugins?.handleUiReport({
        kind: kind as import("../plugins/manifest.ts").PluginEventName,
        ...(taskId ? { taskId } : {}),
        ...(eventDetail ? { detail: eventDetail } : {}),
      })
      return {}
    },
  },
  {
    name: "ui.prompt",
    blocking: true,
    async handle(payload, ctx) {
      // Blocks until an attached TUI answers via `ui.promptReply` (first wins) or timeout.
      const broker = ctx.prompts
      if (!broker) throw new Error("prompt broker unavailable")
      const title = requireString(payload, "title")
      const placeholder = optionalString(payload, "placeholder")
      const initial = optionalString(payload, "initial")
      const rawTimeout = (payload as { timeoutMs?: unknown }).timeoutMs
      const timeoutMs = Math.min(
        typeof rawTimeout === "number" && rawTimeout >= 1000 ? rawTimeout : PROMPT_DEFAULT_TIMEOUT_MS,
        PROMPT_MAX_TIMEOUT_MS,
      )
      const promptId = randomUUID()
      const result = broker.create(promptId, timeoutMs)
      ctx.bus.publish("ui.prompt", {
        promptId,
        title,
        ...(placeholder ? { placeholder } : {}),
        ...(initial ? { initial } : {}),
        at: Date.now(),
      })
      return await result
    },
  },
  {
    name: "ui.promptReply",
    async handle(payload, ctx) {
      const broker = ctx.prompts
      if (!broker) throw new Error("prompt broker unavailable")
      const promptId = requireString(payload, "promptId")
      const value = optionalString(payload, "value")
      const settled = broker.settle(
        promptId,
        value !== undefined ? { value } : { cancelled: true, reason: "cancelled" },
      )
      return { ok: settled }
    },
  },
  {
    name: "tab.open",
    async handle(payload, ctx) {
      // Same trust boundary as `pty.open` (the socket already grants argv
      // execution). The daemon validates + broadcasts; the TUI opens the tab.
      const taskId = requireString(payload, "taskId")
      const title = requireString(payload, "title")
      const argv = (payload as { argv?: unknown }).argv
      if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a) => typeof a === "string" && a.length > 0)) {
        throw new Error("argv must be a non-empty array of strings")
      }
      if (!ctx.orch.getTask(taskId)) throw new Error(`task not found: ${taskId}`)
      const placement = optionalString(payload, "placement")
      const direction = optionalString(payload, "direction")
      const tabId = optionalString(payload, "tabId")
      ctx.bus.publish("tab.open", {
        taskId,
        argv,
        title,
        ...(tabId !== undefined ? { tabId } : {}),
        ...(placement === "tab" || placement === "split" ? { placement } : {}),
        ...(direction === "right" || direction === "down" ? { direction } : {}),
        at: Date.now(),
      })
      // Reach report: `clients` counts CONNECTIONS including the caller, so
      // only 0 is unambiguous ("nobody opened it").
      return { ok: true, clients: ctx.daemon.clientCount() }
    },
  },
  {
    name: "tab.close",
    async handle(payload, ctx) {
      // Closes every pane opened under `title`; the TUI performs it.
      const taskId = requireString(payload, "taskId")
      const title = requireString(payload, "title")
      const tabId = optionalString(payload, "tabId")
      if (!ctx.orch.getTask(taskId)) throw new Error(`task not found: ${taskId}`)
      ctx.bus.publish("tab.close", {
        taskId,
        title,
        ...(tabId !== undefined ? { tabId } : {}),
        at: Date.now(),
      })
      // Lets the caller tell "pane closed" from "nobody was listening".
      return { ok: true, clients: ctx.daemon.clientCount() }
    },
  },
  {
    name: "terminalTab.close",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const tabId = requireString(payload, "tabId")
      if (!ctx.orch.getTask(taskId)) throw new Error(`task not found: ${taskId}`)
      const broker = ctx.tabCloses
      if (!broker || ctx.daemon.guiCount() === 0) return { ok: true, handled: false }

      const requestId = randomUUID()
      const handled = broker.create(requestId, TAB_CLOSE_TUI_TIMEOUT_MS)
      ctx.bus.publish("tab.close", {
        kind: "terminal-tab",
        taskId,
        tabId,
        requestId,
        at: Date.now(),
      })
      return { ok: true, handled: await handled }
    },
  },
  {
    name: "terminalTab.closeReply",
    handle(payload, ctx) {
      const requestId = requireString(payload, "requestId")
      const closed = optionalBoolean(payload, "closed") ?? false
      return { ok: ctx.tabCloses?.settle(requestId, closed) ?? false }
    },
  },
  {
    name: "terminalTab.rename",
    handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const tabId = requireString(payload, "tabId")
      // Empty is legal: "clear back to the default name", as in f2's dialog.
      const title = optionalString(payload, "title") ?? ""
      if (!ctx.orch.getTask(taskId)) throw new Error(`task not found: ${taskId}`)
      ctx.bus.publish("tab.rename", { taskId, tabId, title, at: Date.now() })
      // No broker: the CLI already wrote the snapshot; this is only the repaint.
      return { ok: true, clients: ctx.daemon.clientCount() }
    },
  },
  {
    name: "notice.send",
    async handle(payload, ctx) {
      // One toast per attached UI; each host dedupes replays on `at`.
      const title = requireString(payload, "title")
      const body = optionalString(payload, "body")
      // Free-form: known severities get styled, anything else renders neutrally.
      const kind = optionalString(payload, "kind") ?? "done"
      if (kind.trim() === "") throw new Error("kind must be a non-empty string")
      const taskId = optionalString(payload, "taskId")
      if (taskId !== undefined && !ctx.orch.getTask(taskId)) throw new Error(`task not found: ${taskId}`)
      const source = optionalString(payload, "source")
      ctx.bus.publish("notice.event", { title, body, kind, taskId, at: Date.now(), source })
      // Headless, the toast reaches nobody; `clients` is the only signal.
      return { ok: true, clients: ctx.daemon.clientCount() }
    },
  },
  {
    name: "note.file",
    async handle(payload, ctx) {
      // Field note (docs/design/dispatcher.md). The daemon only ADDRESSES it
      // to the repo's main task; who benefits is the dispatcher's judgment.
      const taskId = requireString(payload, "taskId")
      const text = requireString(payload, "text")
      const author = ctx.orch.getTask(taskId)
      if (!author) throw new Error(`task not found: ${taskId}`)
      const label = displayTaskTitle(author) || taskId
      // Persist BEFORE routing: with no dispatcher running the note must still
      // reach the NEXT session (repo-init reads this store). A store failure
      // must never error a working agent; it degrades to routing-only.
      const persisted = await ctx.notes
        ?.append(author.repo, { at: new Date().toISOString(), text, taskId, author: label })
        .then(() => true)
        .catch(() => false)
      const main = ctx.orch.listTasks().find((t) => (t.kind ?? "task") === "main" && samePath(t.repo, author.repo))
      // No main task, or main noting to itself: accepted but unrouted (persisted above).
      const routed = !!main && main.id !== author.id
      if (routed && main) {
        ctx.bus.publish("session.deliver", {
          taskId: main.id,
          // Note text last and whole (as with [ROVE PEER]), so it reads in the
          // filer's language, not as the tail of an English clause.
          text: `[ROVE FIELD NOTE] from "${label}" (task ${taskId})\n\n${text}`,
          at: Date.now(),
          source: "note",
        })
      }
      // Capped: the envelope rides ROVE_PLUGIN_EVENT_JSON into spawn env
      // (E2BIG risk). Plugins read the full body via note-list.
      ctx.plugins?.handleUiReport({
        kind: "note.filed",
        taskId,
        detail: {
          repo: author.repo,
          author: label,
          text: text.length > 512 ? `${text.slice(0, 512)}…` : text,
          length: text.length,
          routed,
          persisted: persisted ?? false,
        },
      })
      return { ok: true, routed, persisted: persisted ?? false }
    },
  },
  {
    name: "note.list",
    async handle(payload, ctx) {
      // Newest first; also seeds fresh worktree sessions.
      const repo = requireString(payload, "repo")
      return { notes: (await ctx.notes?.list(repo)) ?? [] }
    },
  },
  {
    name: "note.delete",
    async handle(payload, ctx) {
      // `deleted: false` is an answer, not an error: the ring may have evicted it.
      const repo = requireString(payload, "repo")
      const id = requireNumber(payload, "id")
      return { deleted: (await ctx.notes?.remove(repo, id)) ?? false }
    },
  },
]
