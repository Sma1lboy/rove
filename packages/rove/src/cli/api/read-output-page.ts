/**
 * Pure paging/shaping half of `rove api read-output`: the envelope + cursor
 * types, the deterministic page builders, and the terminal-text shaping.
 * No I/O: messages in, page out. Fetching and the verb live in
 * `read-output.ts`, which re-exports this module as the one import site.
 */

import type { PtySessionExit } from "@sma1lboy/rove-daemon/daemon/protocol"
import { terminalRows } from "@sma1lboy/rove-daemon/daemon/terminal-rows"
import type { Message } from "../../types/engine.ts"
import { ApiError } from "./types.ts"

// ── Bounds (deterministic paging) ────────────────────────────────────────────

export const DEFAULT_PAGE_MESSAGES = 40
export const MAX_PAGE_MESSAGES = 50
/** Serialized-bytes budget per history page (always at least one message). */
const PAGE_BYTE_BUDGET = 128 * 1024
/** Any single string inside a message is clipped past this many chars. */
export const STRING_CLIP_CHARS = 16 * 1024
/** Terminal tail caps: lines (default / max) and bytes. */
export const DEFAULT_TAIL_LINES = 40
export const TERMINAL_TAIL_LINES = 200
export const TERMINAL_TAIL_BYTES = 64 * 1024

// ── Envelope + cursor types ──────────────────────────────────────────────────

type ReadSource = "history" | "terminal"
export type ReadSourceArg = "auto" | ReadSource
export type FallbackReason =
  | "engine_unsupported"
  | "history_missing"
  | "history_unreadable"
  /** The pty host could not be asked — "couldn't look", not "no session"
   *  (like `pty-list`'s `sessions: null`). */
  | "pty_host_unreachable"

export interface ReadOutputEnvelope {
  readonly taskId: string
  readonly source: ReadSource
  readonly history?: {
    /** Vendor session id (flat token, never a path). */
    readonly sessionId: string
    readonly messages: readonly unknown[]
    readonly returnedMessageCount: number
    readonly totalMessages: number
    /** Transcript index of `messages[0]`. */
    readonly firstIndex: number
    /** True when the byte budget cut the page short of `limit`. */
    readonly limited: boolean
  }
  readonly terminal?: {
    readonly tail: readonly string[]
    /** True when older output was dropped to fit the tail caps. */
    readonly truncated: boolean
    readonly live: boolean
    /** How the session died when `live` is false — null while alive or
     *  when the host predates exit records. */
    readonly exit?: PtySessionExit | null
    /** The exact tab read (`--tab`); absent for the canonical engine tab. */
    readonly tab?: string
  }
  /** Opaque forward cursor: the next page after this one, and once caught up
   *  the poll point for whatever the session writes next. Null when there is
   *  nothing to page. */
  readonly cursor: string | null
  /** Opaque backward cursor: the page before this one. Null at the start of
   *  the transcript, and always for terminal reads (the ring keeps only a tail). */
  readonly olderCursor: string | null
  /** Why structured history was NOT used (auto only; null on an explicit source). */
  readonly fallbackReason: FallbackReason | null
  readonly warnings: readonly string[]
}

type HistoryCursor = {
  v: 1
  task: string
  src: "history"
  sid: string
  /** Forward: first index to read. Older: exclusive end of the page to read. */
  idx: number
  older?: true
  /** The tab a `--tab` read is pinned to; absent for the task's own engine. */
  tab?: string
}
type TerminalCursor = {
  v: 1
  task: string
  src: "terminal"
  pid: number | null
  off: number
  fr: FallbackReason | null
  /** The tab a `--tab` read is pinned to; absent for canonical-tab reads. */
  tab?: string
}
export type Cursor = HistoryCursor | TerminalCursor
export type { HistoryCursor, TerminalCursor }

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
}

export function decodeCursor(raw: string, taskId: string): Cursor {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
  } catch {
    throw new ApiError("invalid cursor (not a read-output cursor)", "CURSOR_INVALID")
  }
  const c = parsed as Partial<Cursor>
  const shapeOk =
    c !== null &&
    typeof c === "object" &&
    c.v === 1 &&
    typeof c.task === "string" &&
    (c.tab === undefined || typeof c.tab === "string") &&
    ((c.src === "history" &&
      typeof (c as HistoryCursor).sid === "string" &&
      typeof (c as HistoryCursor).idx === "number") ||
      (c.src === "terminal" && typeof (c as TerminalCursor).off === "number"))
  if (!shapeOk) throw new ApiError("invalid cursor (unknown version or shape)", "CURSOR_INVALID")
  if (c.task !== taskId) {
    throw new ApiError(`cursor belongs to task ${c.task}, not ${taskId}`, "CURSOR_TASK_MISMATCH")
  }
  return c as Cursor
}

// ── Bounded page building (pure) ─────────────────────────────────────────────

/** Deep-copy `value` with every long string clipped (bounded pages even
 *  when a single tool result is huge). Messages are plain parsed JSON. */
export function clipStrings(value: unknown): unknown {
  if (typeof value === "string") {
    // Fast path: code points ≤ UTF-16 units, so within the cap in units is
    // within it in points.
    if (value.length <= STRING_CLIP_CHARS) return value
    // Clip on a code-POINT boundary: slicing units can bisect a surrogate pair
    // into U+FFFD, and the clipped tally counts one astral char as one.
    const points = [...value]
    if (points.length <= STRING_CLIP_CHARS) return value
    const kept = points.slice(0, STRING_CLIP_CHARS).join("")
    return `${kept}…[+${points.length - STRING_CLIP_CHARS} chars clipped]`
  }
  if (Array.isArray(value)) return value.map(clipStrings)
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = clipStrings(v)
    return out
  }
  return value
}

export interface HistoryPage {
  readonly page: readonly unknown[]
  /** The page covers transcript indices [start, end). */
  readonly start: number
  readonly end: number
  readonly limited: boolean
}

/** Deterministic page of up to `limit` messages, read forward from `from` or
 *  backward from `before` (exclusive), stopping early — but never before one
 *  message — when the byte budget is spent. Pages are always chronological. */
export function buildHistoryPage(
  messages: readonly Message[],
  at: { readonly from: number } | { readonly before: number },
  limit: number,
): HistoryPage {
  const forward = "from" in at
  const page: unknown[] = []
  let bytes = 0
  let limited = false
  let i = forward ? at.from : at.before - 1
  for (; forward ? i < messages.length : i >= 0; forward ? i++ : i--) {
    if (page.length >= limit) break
    const clipped = clipStrings(messages[i])
    const size = JSON.stringify(clipped).length
    if (page.length > 0 && bytes + size > PAGE_BYTE_BUDGET) {
      limited = true
      break
    }
    page.push(clipped)
    bytes += size
  }
  if (forward) return { page, start: at.from, end: i, limited }
  page.reverse()
  return { page, start: i + 1, end: at.before, limited }
}

// ── Terminal text shaping (pure) ─────────────────────────────────────────────

/** Raw PTY bytes → readable lines. An alt-screen paint writes no newlines, so
 *  escapes must become rows before anything counts lines. */
function terminalLines(text: string): string[] {
  return terminalRows(text)
}

export interface TerminalTail {
  readonly tail: readonly string[]
  readonly truncated: boolean
}

/** Bounded tail: at most `maxLines` (≤ {@link TERMINAL_TAIL_LINES}) lines / {@link TERMINAL_TAIL_BYTES} bytes. */
export function boundedTail(text: string, maxLines: number = TERMINAL_TAIL_LINES): TerminalTail {
  const lines = terminalLines(text)
  let start = Math.max(0, lines.length - Math.min(maxLines, TERMINAL_TAIL_LINES))
  let bytes = 0
  for (let i = lines.length - 1; i >= start; i--) {
    bytes += (lines[i]?.length ?? 0) + 1
    // Always keep the last line even if it alone busts the budget, else the
    // tail comes back empty (same floor as buildHistoryPage).
    if (bytes > TERMINAL_TAIL_BYTES && i < lines.length - 1) {
      start = i + 1
      break
    }
  }
  return { tail: lines.slice(start), truncated: start > 0 }
}

// ── Terminal peek page (the dep read-output injects) ─────────────────────────

export interface TerminalPeekPage {
  readonly pid: number | null
  readonly offset: number
  readonly text: string
  /** False when `sinceOffset` was trimmed out of the ring (gap in output). */
  readonly sinceValid: boolean
  readonly live: boolean
  readonly exit?: PtySessionExit | null
}
