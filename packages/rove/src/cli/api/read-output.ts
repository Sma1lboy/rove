/**
 * `rove api read-output` — cursor-paged read of a task's engine output, so a
 * coordinator agent needn't scrape its terminal.
 *
 *   auto      → engine transcript history, else a bounded terminal tail with
 *               a typed `fallbackReason`.
 *   history   → require history; typed error instead of falling back.
 *   terminal  → bounded terminal tail (never probes history).
 *
 * Contract:
 *   - The first page is the NEWEST: the last `limit` messages, or the last
 *     `limit` terminal lines. `cursor` pages forward and, once caught up, is
 *     the poll point for new output; `olderCursor` pages back through history.
 *   - The envelope ALWAYS names the source used.
 *   - Pages are bounded (message/line count, byte budget, per-string clip) and
 *     deterministic.
 *   - The cursor pins ONE source + session/incarnation (+ tab); a change
 *     underneath is SOURCE_CHANGED, never a silent switch.
 *   - No absolute transcript paths in envelope or cursor.
 *   - Strictly read-only: never spawns, attaches, resizes, or mutates
 *     lifecycle (terminal reads use `pty.peek`).
 *
 * Without `--tab` the read is the task's engine: the worktree's newest
 * session, else the canonical engine tab's terminal. `--tab tab-N` reads that
 * tab: its pinned conversation when it has one, else its terminal.
 */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { protocolEntry, sessionProtocol } from "../../engine/engine-presets.ts"
import { type EngineHistoryReader, supportsStructuredHistory } from "../../engine/registry.ts"
import type { Message } from "../../types/engine.ts"
import type { VendorId } from "../../types/vendor.ts"
import { engineScreenError, peekTaskTerminal } from "./engine-screen.ts"
import { daemonOf } from "./handler-helpers.ts"
import {
  DEFAULT_PAGE_MESSAGES,
  DEFAULT_TAIL_LINES,
  type FallbackReason,
  type HistoryCursor,
  MAX_PAGE_MESSAGES,
  type ReadOutputEnvelope,
  type ReadSourceArg,
  TERMINAL_TAIL_LINES,
  type TerminalCursor,
  type TerminalPeekPage,
  boundedTail,
  buildHistoryPage,
  decodeCursor,
  encodeCursor,
} from "./read-output-page.ts"
import { resolveActiveTaskId } from "./runtime.ts"
import { readTabsSnapshot, taskEngineArgv } from "./tab-snapshot.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"

// Re-exported so `@/cli/api/read-output` stays the one import site.
export {
  boundedTail,
  clipStrings,
  DEFAULT_PAGE_MESSAGES,
  DEFAULT_TAIL_LINES,
  MAX_PAGE_MESSAGES,
  STRING_CLIP_CHARS,
  TERMINAL_TAIL_BYTES,
  TERMINAL_TAIL_LINES,
} from "./read-output-page.ts"
export type {
  ReadOutputEnvelope,
  TerminalPeekPage,
} from "./read-output-page.ts"

// ── The read itself (deps-injected, unit-testable) ───────────────────────────

/** One conversation to page: an engine's transcript reader + the session in it. */
export interface PinnedHistory {
  readonly reader: EngineHistoryReader
  readonly sessionId: string
}

export interface ReadOutputDeps {
  /** The engine adapter's transcript reader; null = engine ships none. */
  readonly history: EngineHistoryReader | null
  /** `--tab`'s conversation: null = not an engine tab (a terminal is all it
   *  has); a FallbackReason = an engine tab whose history can't be read. */
  tabHistory(tab: string): PinnedHistory | FallbackReason | null
  /** `tab` undefined = canonical engine tab. `null` = host answered, no such
   *  session; `"host-unreachable"` = couldn't ask — must not render as empty. */
  peekTerminal(tab: string | undefined, sinceOffset?: number): Promise<TerminalPeekPage | null | "host-unreachable">
}

export interface ReadOutputInput {
  readonly taskId: string
  /** Task worktree (null when not materialized — history is then missing). */
  readonly worktree: string | null
  readonly source: ReadSourceArg
  /** Exact tab to read (`tab-N`) instead of the task's engine. */
  readonly tab?: string
  readonly cursor?: string
  /** Messages (history) or lines (terminal) per page. */
  readonly limit?: number
}

function sourceChanged(detail: string): ApiError {
  return new ApiError(`${detail} — restart the read without the cursor`, "SOURCE_CHANGED")
}

export async function readTaskOutput(input: ReadOutputInput, deps: ReadOutputDeps): Promise<ReadOutputEnvelope> {
  const messageLimit = Math.min(Math.max(input.limit ?? DEFAULT_PAGE_MESSAGES, 1), MAX_PAGE_MESSAGES)
  const lineLimit = Math.min(Math.max(input.limit ?? DEFAULT_TAIL_LINES, 1), TERMINAL_TAIL_LINES)

  if (input.cursor) {
    const cursor = decodeCursor(input.cursor, input.taskId)
    if (input.source !== "auto" && input.source !== cursor.src) {
      throw new ApiError(
        `cursor is pinned to source "${cursor.src}" but --source is "${input.source}"`,
        "CURSOR_INVALID",
      )
    }
    if ((cursor.tab ?? null) !== (input.tab ?? null)) {
      throw new ApiError(
        `cursor is pinned to tab ${cursor.tab ?? "canonical"} — pass the same --tab or restart without the cursor`,
        "CURSOR_INVALID",
      )
    }
    return cursor.src === "history"
      ? continueHistory(input, deps, cursor, messageLimit)
      : continueTerminal(input, deps, cursor, lineLimit)
  }

  if (input.source === "terminal") return firstTerminalPage(input, deps, null, lineLimit)

  const pinned = await resolveHistory(input, deps)
  if (pinned === null) {
    // A non-engine tab: its terminal is the whole story, not a fallback.
    if (input.source === "history") {
      throw new ApiError(`${input.tab} is not an engine tab — it has no structured history`, "HISTORY_REQUIRED")
    }
    return firstTerminalPage(input, deps, null, lineLimit)
  }
  if (typeof pinned === "string") {
    if (input.source === "history") {
      throw new ApiError(`structured history unavailable for ${input.taskId}: ${pinned}`, "HISTORY_REQUIRED")
    }
    return firstTerminalPage(input, deps, pinned, lineLimit)
  }
  let messages: readonly Message[]
  try {
    messages = await pinned.reader.readHistory(pinned.sessionId)
  } catch {
    if (input.source === "history") {
      throw new ApiError(`structured history unavailable for ${input.taskId}: history_unreadable`, "HISTORY_REQUIRED")
    }
    return firstTerminalPage(input, deps, "history_unreadable", lineLimit)
  }
  return historyEnvelope(input, pinned.sessionId, messages, { before: messages.length }, messageLimit)
}

/** The conversation the read targets: the tab's pinned session, else the
 *  worktree's newest (worktrees are task-exclusive, so it's this task's). */
async function resolveHistory(
  input: ReadOutputInput,
  deps: ReadOutputDeps,
): Promise<PinnedHistory | FallbackReason | null> {
  if (input.tab) return deps.tabHistory(input.tab)
  if (!deps.history) return "engine_unsupported"
  if (!input.worktree) return "history_missing"
  let ids: readonly string[]
  try {
    ids = await deps.history.listSessionIdsForWorktree(input.worktree)
  } catch {
    return "history_unreadable"
  }
  const sid = ids[ids.length - 1]
  return sid ? { reader: deps.history, sessionId: sid } : "history_missing"
}

async function continueHistory(
  input: ReadOutputInput,
  deps: ReadOutputDeps,
  cursor: HistoryCursor,
  limit: number,
): Promise<ReadOutputEnvelope> {
  const pinned = await resolveHistory(input, deps)
  if (pinned === null || pinned === "engine_unsupported") {
    throw sourceChanged("the engine no longer provides structured history")
  }
  if (pinned === "history_unreadable") {
    throw new ApiError("history became unreadable — retry, or restart without the cursor", "HISTORY_UNREADABLE")
  }
  // New session (resume/compaction): never silently merge or switch.
  const sid = typeof pinned === "string" ? null : pinned.sessionId
  if (typeof pinned === "string" || sid !== cursor.sid) {
    throw sourceChanged(`the engine session changed (was ${cursor.sid}, now ${sid ?? "none"})`)
  }
  let messages: readonly Message[]
  try {
    messages = await pinned.reader.readHistory(cursor.sid)
  } catch {
    throw new ApiError("history became unreadable — retry, or restart without the cursor", "HISTORY_UNREADABLE")
  }
  // Transcripts are append-only; a shrink means the pinned session was rewritten.
  if (cursor.idx > messages.length) throw sourceChanged("the pinned transcript shrank")
  return historyEnvelope(
    input,
    cursor.sid,
    messages,
    cursor.older ? { before: cursor.idx } : { from: cursor.idx },
    limit,
  )
}

function historyEnvelope(
  input: ReadOutputInput,
  sessionId: string,
  messages: readonly Message[],
  at: { readonly from: number } | { readonly before: number },
  limit: number,
): ReadOutputEnvelope {
  const { page, start, end, limited } = buildHistoryPage(messages, at, limit)
  const base = { v: 1, task: input.taskId, src: "history", sid: sessionId, tab: input.tab } as const
  return {
    taskId: input.taskId,
    source: "history",
    history: {
      sessionId,
      messages: page,
      returnedMessageCount: page.length,
      totalMessages: messages.length,
      firstIndex: start,
      limited,
    },
    // Always a forward cursor: the session may still append — a poll point, not an end.
    cursor: encodeCursor({ ...base, idx: end }),
    olderCursor: start > 0 ? encodeCursor({ ...base, idx: start, older: true }) : null,
    fallbackReason: null,
    warnings: [],
  }
}

async function firstTerminalPage(
  input: ReadOutputInput,
  deps: ReadOutputDeps,
  fallbackReason: FallbackReason | null,
  lines: number,
): Promise<ReadOutputEnvelope> {
  const t = await deps.peekTerminal(input.tab)
  if (!t || t === "host-unreachable") {
    // An unreachable host is not an empty task: its state wins the
    // fallbackReason and the warning says nothing was checked.
    const unreachable = t === "host-unreachable"
    return {
      taskId: input.taskId,
      source: "terminal",
      terminal: { tail: [], truncated: false, live: false, tab: input.tab },
      cursor: null,
      olderCursor: null,
      fallbackReason: unreachable ? "pty_host_unreachable" : fallbackReason,
      warnings: [
        unreachable
          ? "the pty host could not be reached — this is 'could not look', not 'no session'"
          : "no live terminal session for this task",
      ],
    }
  }
  const { tail, truncated } = boundedTail(t.text, lines)
  return {
    taskId: input.taskId,
    source: "terminal",
    terminal: { tail, truncated, live: t.live, exit: t.exit ?? null, tab: input.tab },
    cursor: encodeCursor({
      v: 1,
      task: input.taskId,
      src: "terminal",
      pid: t.pid,
      off: t.offset,
      fr: fallbackReason,
      tab: input.tab,
    }),
    olderCursor: null,
    fallbackReason,
    warnings: [],
  }
}

async function continueTerminal(
  input: ReadOutputInput,
  deps: ReadOutputDeps,
  cursor: TerminalCursor,
  lines: number,
): Promise<ReadOutputEnvelope> {
  const t = await deps.peekTerminal(cursor.tab, cursor.off)
  if (t === "host-unreachable") throw sourceChanged("the pty host could not be reached")
  if (!t) throw sourceChanged("the terminal session is gone")
  if (t.pid !== cursor.pid) throw sourceChanged("the terminal session restarted (new process)")
  const warnings = t.sinceValid ? [] : ["scrollback trimmed — there is a gap before this page"]
  const { tail, truncated } = boundedTail(t.text, lines)
  const fr = cursor.fr ?? null
  return {
    taskId: input.taskId,
    source: "terminal",
    terminal: { tail, truncated, live: t.live, exit: t.exit ?? null, tab: cursor.tab },
    cursor: encodeCursor({ v: 1, task: input.taskId, src: "terminal", pid: t.pid, off: t.offset, fr, tab: cursor.tab }),
    olderCursor: null,
    fallbackReason: fr,
    warnings,
  }
}

// ── Real deps + the verb ─────────────────────────────────────────────────────

/** A tab's pinned conversation, from the persisted tab snapshot. */
function snapshotTabHistory(task: SerializedTask, tabId: string): PinnedHistory | FallbackReason | null {
  const tab = readTabsSnapshot(task.id)?.tabs.find((t) => t.id === tabId)
  if (!tab || tab.kind !== "engine") return null
  const vendor = tab.vendor ?? (task.vendor as VendorId | undefined)
  if (!vendor || !supportsStructuredHistory(sessionProtocol(vendor))) return "engine_unsupported"
  // Vendors that can't take a caller-set id (codex/custom) pin none.
  return tab.sessionId ? { reader: protocolEntry(vendor).history, sessionId: tab.sessionId } : "history_missing"
}

async function handleReadOutput(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  let taskId = ctx.args.str("task-id")
  if (!taskId) {
    const active = await resolveActiveTaskId(daemon)
    if (!active) {
      throw new ApiError("no --task-id given and no active task — pass --task-id", "MISSING_TARGET")
    }
    taskId = active
  }
  const { task } = await daemon.request<{ task: SerializedTask }>("task.get", { taskId })
  const vendor = task.vendor as VendorId | undefined
  // The task's OWN launch binary: `findEngineKey` matches spawn argv, and a
  // wrapper command (`claudecpa`, custom presets) never carries the vendor's word.
  const engineBin = vendor || task.command ? taskEngineArgv(task)[0] : undefined
  const tab = ctx.args.str("tab")
  const deps: ReadOutputDeps = {
    history: vendor && supportsStructuredHistory(sessionProtocol(vendor)) ? protocolEntry(vendor).history : null,
    tabHistory: (tabId) => snapshotTabHistory(task, tabId),
    peekTerminal: (tabId, sinceOffset) => peekTaskTerminal(taskId, engineBin, tabId, sinceOffset),
  }
  const envelope = await readTaskOutput(
    {
      taskId,
      worktree: task.worktreePath ?? null,
      source: ctx.args.enumOf<ReadSourceArg>("source") ?? "auto",
      tab,
      cursor: ctx.args.str("cursor"),
      limit: ctx.args.int("limit"),
    },
    deps,
  )
  const running = await ctx.runtime.isTaskRunning(taskId, taskEngineArgv(task))
  // A history page can't show a turn that failed before the engine wrote
  // anything; the engine's own error row on screen can.
  const engineError = envelope.source === "history" && !tab ? await engineScreenError(task) : undefined
  return { vendor: vendor ?? null, running, ...envelope, ...(engineError ? { engineError } : {}) }
}

export const READ_OUTPUT_VERB: VerbSpec = {
  name: "read-output",
  group: "read",
  summary:
    "Read what a task's engine is doing, newest first, as bounded JSON: the engine's own structured history when available, else a labeled terminal tail (typed fallbackReason). The first page is the LATEST — the last --limit messages or terminal lines. `cursor` pages forward and, once caught up, is the poll point: re-read with it to get only what the session wrote since (pair with `watch` to know when). `olderCursor` pages back through history. --tab tab-N reads one exact tab: its own conversation when it is an engine tab with one, else its terminal. Read-only — never attaches or types; the cursor stays pinned to one source/session/tab (SOURCE_CHANGED when it moved). A history read also carries `engineError` when the engine's screen ends on an error row it never wrote to its transcript (a turn that failed before replying).",
  flags: [
    {
      name: "task-id",
      type: "string",
      placeholder: "ID",
      description: "Target task id (defaults to the active task).",
    },
    {
      name: "tab",
      type: "string",
      placeholder: "TAB",
      description:
        "Read exactly this tab (e.g. tab-3, ids from `get-task` .tabs[]) instead of the task's engine: an engine tab's own pinned conversation when it has one, else that tab's terminal.",
    },
    {
      name: "source",
      type: "enum",
      values: ["auto", "history", "terminal"],
      default: "auto",
      description:
        "auto = structured history else terminal fallback; history = require structured (typed error instead of fallback); terminal = bounded terminal tail.",
    },
    {
      name: "cursor",
      type: "string",
      placeholder: "C",
      description:
        "Opaque `cursor` (forward / poll) or `olderCursor` (back) from a previous page. Pinned to that page's source, session and tab.",
    },
    {
      name: "limit",
      type: "int",
      placeholder: "N",
      description: `Page size: history messages (default ${DEFAULT_PAGE_MESSAGES}, max ${MAX_PAGE_MESSAGES}) or terminal lines (default ${DEFAULT_TAIL_LINES}, max ${TERMINAL_TAIL_LINES}).`,
    },
  ],
  handler: handleReadOutput,
}
