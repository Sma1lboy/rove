/**
 * `kobe api read-output` — cursor-paged read of a task's engine output, so a
 * coordinator agent needn't scrape its terminal.
 *
 *   auto      → engine transcript history, else a bounded terminal tail with
 *               a typed `fallbackReason`.
 *   history   → require history; typed error instead of falling back.
 *   terminal  → bounded terminal tail (never probes history).
 *
 * Contract:
 *   - The envelope ALWAYS names the source used.
 *   - Pages are bounded (message count, byte budget, per-string clip) and
 *     deterministic.
 *   - The cursor pins ONE source + session/incarnation (+ tab); a change
 *     underneath is SOURCE_CHANGED, never a silent switch.
 *   - No absolute transcript paths in envelope or cursor.
 *   - Strictly read-only: never spawns, attaches, resizes, or mutates
 *     lifecycle (terminal reads use `pty.peek`).
 *
 * Default terminal read = the canonical engine tab; `--tab tab-N` reads that
 * session and is terminal-only (history is worktree-scoped).
 */

import type { PtyPeekResult, SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { protocolEntry, sessionProtocol } from "../../engine/engine-presets.ts"
import { type EngineHistoryReader, supportsStructuredHistory } from "../../engine/registry.ts"
import type { Message } from "../../types/engine.ts"
import type { VendorId } from "../../types/vendor.ts"
import { daemonOf } from "./handler-helpers.ts"
import { findEngineKey, listSessionsOrNull, openPtyHost } from "./pty-delivery.ts"
import {
  DEFAULT_PAGE_MESSAGES,
  type FallbackReason,
  type HistoryCursor,
  MAX_PAGE_MESSAGES,
  type ReadOutputEnvelope,
  type ReadSourceArg,
  type TerminalCursor,
  type TerminalPeekPage,
  boundedTail,
  buildHistoryPage,
  decodeCursor,
  encodeCursor,
} from "./read-output-page.ts"
import { resolveActiveTaskId } from "./runtime.ts"
import { taskEngineArgv } from "./tab-snapshot.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"

// Re-exported so `@/cli/api/read-output` stays the one import site.
export {
  boundedTail,
  clipStrings,
  DEFAULT_PAGE_MESSAGES,
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

export interface ReadOutputDeps {
  /** The engine adapter's transcript reader; null = engine ships none. */
  readonly history: EngineHistoryReader | null
  /** `tab` undefined = canonical engine tab. `null` = host answered, no such
   *  session; `"host-unreachable"` = couldn't ask — must not render as empty. */
  peekTerminal(tab: string | undefined, sinceOffset?: number): Promise<TerminalPeekPage | null | "host-unreachable">
}

export interface ReadOutputInput {
  readonly taskId: string
  /** Task worktree (null when not materialized — history is then missing). */
  readonly worktree: string | null
  readonly source: ReadSourceArg
  /** Exact terminal tab to read (`tab-N`); implies a terminal-only read. */
  readonly tab?: string
  readonly cursor?: string
  readonly limit?: number
}

function sourceChanged(detail: string): ApiError {
  return new ApiError(`${detail} — restart the read without the cursor`, "SOURCE_CHANGED")
}

export async function readTaskOutput(input: ReadOutputInput, deps: ReadOutputDeps): Promise<ReadOutputEnvelope> {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_PAGE_MESSAGES, 1), MAX_PAGE_MESSAGES)

  if (input.tab && input.source === "history") {
    throw new ApiError("--tab reads one terminal tab; --source history is task/worktree-scoped", "BAD_FLAG")
  }

  if (input.cursor) {
    const cursor = decodeCursor(input.cursor, input.taskId)
    if (input.source !== "auto" && input.source !== cursor.src) {
      throw new ApiError(
        `cursor is pinned to source "${cursor.src}" but --source is "${input.source}"`,
        "CURSOR_INVALID",
      )
    }
    if (input.tab && cursor.src !== "terminal") {
      throw new ApiError(`cursor is pinned to source "${cursor.src}" but --tab reads a terminal tab`, "CURSOR_INVALID")
    }
    if (cursor.src === "terminal" && (cursor.tab ?? null) !== (input.tab ?? null)) {
      throw new ApiError(
        `cursor is pinned to tab ${cursor.tab ?? "canonical"} — pass the same --tab or restart without the cursor`,
        "CURSOR_INVALID",
      )
    }
    return cursor.src === "history"
      ? continueHistory(input, deps, cursor, limit)
      : continueTerminal(input, deps, cursor)
  }

  if (input.tab || input.source === "terminal") return firstTerminalPage(input, deps, null)

  const first = await tryFirstHistoryPage(input, deps, limit)
  if (typeof first !== "string") return first
  if (input.source === "history") {
    throw new ApiError(`structured history unavailable for ${input.taskId}: ${first}`, "HISTORY_REQUIRED")
  }
  return firstTerminalPage(input, deps, first)
}

/** Newest session for the worktree; worktrees are task-exclusive, so it's this task's. */
async function currentSessionId(history: EngineHistoryReader, worktree: string): Promise<string | null> {
  const ids = await history.listSessionIdsForWorktree(worktree)
  return ids.length > 0 ? (ids[ids.length - 1] ?? null) : null
}

async function tryFirstHistoryPage(
  input: ReadOutputInput,
  deps: ReadOutputDeps,
  limit: number,
): Promise<ReadOutputEnvelope | FallbackReason> {
  if (!deps.history) return "engine_unsupported"
  if (!input.worktree) return "history_missing"
  let sid: string | null
  try {
    sid = await currentSessionId(deps.history, input.worktree)
  } catch {
    return "history_unreadable"
  }
  if (!sid) return "history_missing"
  let messages: readonly Message[]
  try {
    messages = await deps.history.readHistory(sid)
  } catch {
    return "history_unreadable"
  }
  return historyEnvelope(input.taskId, sid, messages, 0, limit)
}

async function continueHistory(
  input: ReadOutputInput,
  deps: ReadOutputDeps,
  cursor: HistoryCursor,
  limit: number,
): Promise<ReadOutputEnvelope> {
  if (!deps.history || !input.worktree) throw sourceChanged("the engine no longer provides structured history")
  let sid: string | null
  let messages: readonly Message[]
  try {
    sid = await currentSessionId(deps.history, input.worktree)
    messages = sid === cursor.sid ? await deps.history.readHistory(cursor.sid) : []
  } catch {
    throw new ApiError("history became unreadable — retry, or restart without the cursor", "HISTORY_UNREADABLE")
  }
  // New session (resume/compaction): never silently merge or switch.
  if (sid !== cursor.sid)
    throw sourceChanged(`the task's engine session changed (was ${cursor.sid}, now ${sid ?? "none"})`)
  // Transcripts are append-only; a shrink means the pinned session was rewritten.
  if (cursor.idx > messages.length) throw sourceChanged("the pinned transcript shrank")
  return historyEnvelope(input.taskId, cursor.sid, messages, cursor.idx, limit)
}

function historyEnvelope(
  taskId: string,
  sessionId: string,
  messages: readonly Message[],
  startIdx: number,
  limit: number,
): ReadOutputEnvelope {
  const { page, nextIdx, limited } = buildHistoryPage(messages, startIdx, limit)
  return {
    taskId,
    source: "history",
    history: {
      sessionId,
      messages: page,
      returnedMessageCount: page.length,
      totalMessages: messages.length,
      limited,
    },
    // Always a cursor: the session may still append — a poll point, not an end.
    cursor: encodeCursor({ v: 1, task: taskId, src: "history", sid: sessionId, idx: nextIdx }),
    fallbackReason: null,
    warnings: [],
  }
}

async function firstTerminalPage(
  input: ReadOutputInput,
  deps: ReadOutputDeps,
  fallbackReason: FallbackReason | null,
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
      fallbackReason: unreachable ? "pty_host_unreachable" : fallbackReason,
      warnings: [
        unreachable
          ? "the pty host could not be reached — this is 'could not look', not 'no session'"
          : "no live terminal session for this task",
      ],
    }
  }
  const { tail, truncated } = boundedTail(t.text)
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
    fallbackReason,
    warnings: [],
  }
}

async function continueTerminal(
  input: ReadOutputInput,
  deps: ReadOutputDeps,
  cursor: TerminalCursor,
): Promise<ReadOutputEnvelope> {
  const t = await deps.peekTerminal(cursor.tab, cursor.off)
  if (t === "host-unreachable") throw sourceChanged("the pty host could not be reached")
  if (!t) throw sourceChanged("the terminal session is gone")
  if (t.pid !== cursor.pid) throw sourceChanged("the terminal session restarted (new process)")
  const warnings = t.sinceValid ? [] : ["scrollback trimmed — there is a gap before this page"]
  const { tail, truncated } = boundedTail(t.text)
  const fr = cursor.fr ?? null
  return {
    taskId: input.taskId,
    source: "terminal",
    terminal: { tail, truncated, live: t.live, exit: t.exit ?? null, tab: cursor.tab },
    cursor: encodeCursor({ v: 1, task: input.taskId, src: "terminal", pid: t.pid, off: t.offset, fr, tab: cursor.tab }),
    fallbackReason: fr,
    warnings,
  }
}

// ── Real deps + the verb ─────────────────────────────────────────────────────

/** Read-only `pty.peek`; never spawns. A failed host connect/list/peek RPC is
 *  "host-unreachable"; any other non-ApiError failure reads as null.
 *
 *  An explicit unknown `tab` is TAB_NOT_FOUND, not empty. Without one:
 *  findEngineKey matches only ALIVE sessions, so fall back to `tab-1` (the
 *  engine tab the TUI mints first) to read a dead engine's scrollback. */
async function peekTaskTerminal(
  taskId: string,
  engineBin: string | undefined,
  tab: string | undefined,
  sinceOffset?: number,
): Promise<TerminalPeekPage | null | "host-unreachable"> {
  const host = await openPtyHost()
  if (!host) return "host-unreachable"
  try {
    let key: string | undefined
    if (tab) {
      key = `${taskId}::${tab}`
    } else {
      // Tri-state: an unaskable host is not "no sessions".
      const sessions = await listSessionsOrNull(host.rpc)
      if (sessions === null) return "host-unreachable"
      key = findEngineKey(sessions, taskId, engineBin) ?? sessions.find((s) => s.key === `${taskId}::tab-1`)?.key
    }
    if (!key) return null
    // With --tab this is the first RPC; its failure means unreachable, not empty.
    let res: PtyPeekResult
    try {
      res = await host.rpc.request<PtyPeekResult>("pty.peek", { key, sinceOffset })
    } catch {
      return "host-unreachable"
    }
    if (!res.exists) {
      if (tab) {
        throw new ApiError(
          `tab ${tab} has no hosted session on task ${taskId} — see \`rove api pty-list\` for live tabs`,
          "TAB_NOT_FOUND",
        )
      }
      return null
    }
    return {
      pid: res.pid,
      offset: res.offset,
      text: Buffer.from(res.data, "base64").toString("utf8"),
      sinceValid: res.sinceValid,
      live: res.alive,
      exit: res.exit ?? null,
    }
  } catch (err) {
    if (err instanceof ApiError) throw err
    return null
  } finally {
    host.close()
  }
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
  return { vendor: vendor ?? null, running, ...envelope }
}

export const READ_OUTPUT_VERB: VerbSpec = {
  name: "read-output",
  group: "read",
  summary:
    "Read a task's engine output as bounded, cursor-paged JSON: the engine's own structured history when available, else a labeled terminal tail (typed fallbackReason). --tab tab-N reads one exact terminal tab. Read-only; the cursor stays pinned to one source/session/tab (SOURCE_CHANGED when it moved).",
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
        "Read exactly this terminal tab's hosted session (e.g. tab-3) instead of the canonical engine tab. Terminal-only read; cannot combine with --source history.",
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
      description: "Opaque cursor from the previous page. Pinned to that page's source and session.",
    },
    {
      name: "limit",
      type: "int",
      placeholder: "N",
      default: String(DEFAULT_PAGE_MESSAGES),
      description: `History messages per page (default ${DEFAULT_PAGE_MESSAGES}, max ${MAX_PAGE_MESSAGES}).`,
    },
  ],
  handler: handleReadOutput,
}
