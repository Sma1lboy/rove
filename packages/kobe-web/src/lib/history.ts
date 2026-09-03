/**
 * Engine-history client — browser mirrors of the engine's neutral history
 * shapes (packages/kobe/src/types/engine.ts Message / ContentBlock /
 * EngineUsageSnapshot) plus the fetchers for the bridge's /api/history
 * routes. Mirrored locally (like types.ts) so no server code leaks into
 * the client bundle. Usage arrives as the reader's normalized snapshot —
 * the client never sums per-message vendor fields or re-derives context
 * math (engine-owned UI data, AGENTS.md).
 */

import { api } from "./api-client.ts"

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_call"; callId: string; name: string; input: unknown }
  | { type: "tool_result"; callId: string; output: unknown; isError: boolean }
  | { type: "thinking"; text: string }

/**
 * Browser mirror of the engine-neutral `EngineUsageSnapshot`
 * (kobe/src/types/engine.ts) — the session-aggregate figures the adapter
 * derived from its own transcript. Absent from the wire when the engine
 * doesn't surface usage; that is "not reported", not "zero".
 */
export interface EngineUsageSnapshot {
  readonly input_tokens: number
  readonly output_tokens: number
  readonly cache_read_input_tokens?: number
  readonly cache_creation_input_tokens?: number
  /** Tokens currently in the session's context window, when known. */
  readonly context_tokens?: number
  /** True when `context_tokens` is engine-estimated rather than engine-reported. */
  readonly context_tokens_approximate?: boolean
  /** Model context window, when known. */
  readonly context_window_tokens?: number
}

export interface HistoryMessage {
  role: "user" | "assistant" | "system"
  blocks: ContentBlock[]
  timestamp: string
  sessionId: string
}

export interface SessionsResult {
  /** Oldest-first (reader contract) — the latest session is the last entry. */
  sessions: string[]
  /** Newest transcript mtime for the worktree; 0 = none yet. */
  latestMtime: number
}

export interface MessagesResult {
  messages: HistoryMessage[]
  /** The reader's neutral usage snapshot; absent = the engine doesn't report usage. */
  usage?: EngineUsageSnapshot
}

export function fetchSessions(
  worktreePath: string,
  vendor: string,
): Promise<SessionsResult> {
  return api.get<SessionsResult>("/api/history/sessions", {
    query: { worktreePath, vendor },
    label: "/api/history/sessions",
  })
}

export function fetchMessages(
  vendor: string,
  sessionId: string,
): Promise<MessagesResult> {
  return api.get<MessagesResult>("/api/history/messages", {
    query: { vendor, sessionId },
    label: "/api/history/messages",
  })
}

export interface UsageSummary {
  /** Session's fresh input tokens (engine-reported aggregate). */
  inputTokens: number
  /** Session's output tokens (engine-reported aggregate). */
  outputTokens: number
  /** Live context estimate, when the engine reports one. */
  contextTokens: number
}

/**
 * Unpack the bridge's neutral snapshot into the header's display numbers.
 * No math here — the adapter owns every derivation. `undefined` means the
 * engine doesn't surface usage (kimi's unverified wire, custom engines):
 * the header renders no chips, mirroring read-output's `engine_unsupported`
 * honesty — "not reported" must never display as zero.
 */
export function summarizeUsage(
  usage: EngineUsageSnapshot | undefined,
): UsageSummary {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    contextTokens: usage?.context_tokens ?? 0,
  }
}

/** Compact token formatting: 1234 → "1.2k", 1234567 → "1.2m". */
export function formatTokens(value: number): string {
  // Promote at 999,950, not 1,000,000: once value/1000 rounds to "1000.0" at
  // one decimal it must render as the next unit ("1.0m", never "1000.0k").
  // Same promote-before-round rule as kobe's lib/format-bytes.ts.
  if (value >= 999_950) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}
