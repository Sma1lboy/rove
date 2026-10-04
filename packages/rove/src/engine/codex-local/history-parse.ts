/**
 * Codex rollout JSONL → Message[], on the append-aware per-file cache
 * (`../history-cache.ts`) so ~2.5s `readHistory` polls don't re-parse the file.
 *
 * One fold pass extracts both messages and the latest usage snapshot. The fold
 * is line-local apart from the usage carry-over, which threads through the
 * cached state, so folding an appended slice onto the cached prefix equals a
 * full parse, with stable message identities.
 */

import type { ContentBlock } from "@/types/content"
import type { EngineHistory, EngineUsageSnapshot, Message } from "@/types/engine"
import { isJsonlLineWithinBound } from "../file-bounds"
import { createAppendParseCache, sortByTimestamp } from "../history-cache"
import { normalizeCodexContent } from "./normalize"
import { isSyntheticCodexUserRow } from "./synthetic"
import { codexUsageToSnapshot } from "./usage"

interface CodexParseState {
  /** `response_item` messages in file order (pre-sort). */
  readonly messages: readonly Message[]
  /** Winning usage snapshot so far (token_count / turn.completed). */
  readonly latestUsage: EngineUsageSnapshot | undefined
  /** Timestamp (epoch ms) of that snapshot, when it carried one. */
  readonly latestUsageTimestampMs: number | null
}

const emptyState: CodexParseState = { messages: [], latestUsage: undefined, latestUsageTimestampMs: null }

const cache = createAppendParseCache<CodexParseState, string>({
  initial: () => emptyState,
  parseChunk: foldRolloutChunk,
})

/** Parse the full rollout `raw`, reusing the cached fold when the file only appended. */
export function parseRolloutRaw(filePath: string, raw: string, sessionId: string): EngineHistory {
  const state = cache(filePath, raw, sessionId)
  const messages = sortByTimestamp(state.messages)
  return { messages, ...(state.latestUsage ? { usageMetrics: state.latestUsage } : {}) }
}

/** Uncached message-only parse. */
export function parseJsonl(raw: string, sessionId: string): readonly Message[] {
  return foldRolloutChunk(raw, emptyState, sessionId).messages
}

/** Latest usage snapshot in `raw` (token_count / turn.completed), uncached. */
export function deriveCodexUsageMetrics(raw: string): EngineUsageSnapshot | undefined {
  return foldRolloutChunk(raw, emptyState, "").latestUsage
}

/** Fold rollout lines onto `prev` without mutating it (cache contract). */
function foldRolloutChunk(chunk: string, prev: CodexParseState, sessionId: string): CodexParseState {
  let updatedMessages: Message[] | undefined
  const writableMessages = () => {
    updatedMessages ??= [...prev.messages]
    return updatedMessages
  }
  let latestUsage = prev.latestUsage
  let latestUsageTimestampMs = prev.latestUsageTimestampMs

  for (const line of chunk.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (!isJsonlLineWithinBound(trimmed)) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isObject(parsed)) continue

    if (parsed.type === "response_item") {
      const payload = isObject(parsed.payload) ? parsed.payload : undefined
      if (!payload) continue
      const ts = typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString()
      const msg = normalizeCodexResponseItem(payload, ts, sessionId)
      if (msg) writableMessages().push(msg)
      continue
    }

    const usageFields = codexUsageFields(parsed)
    if (!usageFields) continue
    const base = codexUsageToSnapshot(usageFields.usage, { contextWindowTokens: usageFields.contextWindow })
    if (!base) continue
    // Last turn's total input (cached included) IS the context size. Engine-reported,
    // so not approximate; absent when the record has no per-turn split.
    const lastPrompt = usageFields.lastUsage ? numberOr(usageFields.lastUsage.input_tokens) : 0
    const snapshot: EngineUsageSnapshot = {
      ...base,
      ...(lastPrompt > 0 ? { context_tokens: lastPrompt } : {}),
    }
    // token_count follows its turn's response_items, so the nearest preceding
    // assistant message owns this turn's usage. Replace, never mutate (cache contract).
    const lastUsage = usageFields.lastUsage && codexLastUsageToMessageUsage(usageFields.lastUsage)
    if (lastUsage) {
      const messages = updatedMessages ?? prev.messages
      const index = messages.findLastIndex((message) => message.role === "assistant")
      const message = messages[index]
      if (message) writableMessages()[index] = { ...message, usage: lastUsage }
    }
    const timestampMs = typeof parsed.timestamp === "string" ? parseTimestampMs(parsed.timestamp) : null
    if (timestampMs !== null && (latestUsageTimestampMs === null || timestampMs > latestUsageTimestampMs)) {
      latestUsageTimestampMs = timestampMs
      latestUsage = snapshot
    } else if (latestUsageTimestampMs === null) {
      // No timestamped winner yet: keep advancing in FILE order. Gating on
      // `latestUsage === undefined` would freeze on untimestamped turn 1.
      latestUsage = snapshot
    }
  }

  return { messages: updatedMessages ?? prev.messages, latestUsage, latestUsageTimestampMs }
}

/** A usage record's token fields plus the model context window it reported. */
interface CodexUsageFields {
  /** Session-cumulative usage → the aggregate `usageMetrics` snapshot. */
  readonly usage: Record<string, unknown>
  /** This turn's delta → stamped onto the turn's assistant Message. */
  readonly lastUsage: Record<string, unknown> | undefined
  readonly contextWindow: number | undefined
}

/**
 * Token usage + context window from a rollout usage record, or `undefined`.
 * Two shapes:
 *
 *   - REAL rollout (what codex-cli writes to `~/.codex/sessions/**.jsonl`):
 *     `{ type: "event_msg", payload: { type: "token_count", info: {
 *     total_token_usage, last_token_usage, model_context_window } } }` —
 *     session aggregate and this turn's delta.
 *   - LEGACY `codex exec --json`: `{ type: "turn.completed", usage: {…} }`
 *     (no context window, no per-turn split).
 */
function codexUsageFields(parsed: Record<string, unknown>): CodexUsageFields | undefined {
  if (parsed.type === "event_msg") {
    const payload = isObject(parsed.payload) ? parsed.payload : undefined
    if (payload?.type !== "token_count") return undefined
    const info = isObject(payload.info) ? payload.info : undefined
    const usage = info && isObject(info.total_token_usage) ? info.total_token_usage : undefined
    if (!usage) return undefined
    const lastUsage = info && isObject(info.last_token_usage) ? info.last_token_usage : undefined
    const contextWindow = typeof info?.model_context_window === "number" ? info.model_context_window : undefined
    return { usage, lastUsage, contextWindow }
  }
  if (parsed.type === "turn.completed") {
    const usage = isObject(parsed.usage) ? parsed.usage : undefined
    // Stream shape is per-turn already, so it doubles as `lastUsage`.
    return usage ? { usage, lastUsage: usage, contextWindow: undefined } : undefined
  }
  return undefined
}

/** Map codex `last_token_usage` (a TokenUsage) to the neutral `Message.usage`
 *  shape (non-cached input + output + cache read), or undefined when empty. */
function codexLastUsageToMessageUsage(usage: Record<string, unknown>): Message["usage"] | undefined {
  const totalInput = numberOr(usage.input_tokens)
  const cachedInput = numberOr(usage.cached_input_tokens)
  const output = numberOr(usage.output_tokens)
  if (totalInput <= 0 && output <= 0 && cachedInput <= 0) return undefined
  return {
    input_tokens: Math.max(0, totalInput - cachedInput),
    output_tokens: output,
    ...(cachedInput > 0 ? { cache_read_input_tokens: cachedInput } : {}),
  }
}

function numberOr(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0
}

function normalizeCodexResponseItem(
  payload: Record<string, unknown>,
  timestamp: string,
  sessionId: string,
): Message | undefined {
  if (payload.type === "message") {
    const role = payload.role
    if (role !== "user" && role !== "assistant" && role !== "system") return undefined
    const blocks = normalizeCodexContent(payload.content)
    // Codex persists repo instructions and the environment envelope as
    // role=user rows the live stream never shows; hide them.
    if (role === "user" && isSyntheticCodexUserRow(blocks)) return undefined
    return { role, blocks, timestamp, sessionId }
  }

  if (payload.type === "reasoning") return normalizeCodexReasoning(payload, timestamp, sessionId)

  if (payload.type === "function_call") {
    return normalizeCodexToolCall(payload, timestamp, sessionId, {
      name: stringOr(payload.name, "function_call"),
      input: parseMaybeJson(payload.arguments),
    })
  }
  if (payload.type === "custom_tool_call") {
    return normalizeCodexToolCall(payload, timestamp, sessionId, {
      name: stringOr(payload.name, "custom_tool_call"),
      input: parseMaybeJson(payload.input),
    })
  }
  if (payload.type === "tool_search_call") {
    return normalizeCodexToolCall(payload, timestamp, sessionId, {
      name: "tool_search_call",
      input: stripPayload(payload, ["type", "call_id", "status"]),
    })
  }

  if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
    return normalizeCodexToolResult(payload, timestamp, sessionId, parseMaybeJson(payload.output))
  }
  if (payload.type === "tool_search_output") {
    return normalizeCodexToolResult(payload, timestamp, sessionId, stripPayload(payload, ["type", "call_id"]))
  }

  if (
    payload.type === "web_search_call" ||
    payload.type === "image_generation_call" ||
    payload.type === "local_shell_call"
  ) {
    return normalizeSingleRecordTool(payload, timestamp, sessionId)
  }

  return undefined
}

function normalizeCodexReasoning(
  payload: Record<string, unknown>,
  timestamp: string,
  sessionId: string,
): Message | undefined {
  const text = reasoningTextFromItem(payload)
  if (text.length === 0) return undefined
  return { role: "assistant", blocks: [{ type: "thinking", text }], timestamp, sessionId }
}

function normalizeCodexToolCall(
  payload: Record<string, unknown>,
  timestamp: string,
  sessionId: string,
  args: { readonly name: string; readonly input: unknown },
): Message | undefined {
  const callId = typeof payload.call_id === "string" ? payload.call_id : undefined
  if (!callId) return undefined
  const block: ContentBlock = {
    type: "tool_call",
    callId,
    name: args.name,
    input: args.input,
  }
  return { role: "assistant", blocks: [block], timestamp, sessionId }
}

function normalizeCodexToolResult(
  payload: Record<string, unknown>,
  timestamp: string,
  sessionId: string,
  output: unknown,
): Message | undefined {
  const callId = typeof payload.call_id === "string" ? payload.call_id : undefined
  if (!callId) return undefined
  const block: ContentBlock = {
    type: "tool_result",
    callId,
    output,
    isError: false,
  }
  return { role: "user", blocks: [block], timestamp, sessionId }
}

/**
 * Non-failure statuses for a single-record tool (`in_progress` = still
 * running). Anything else (`failed`, `incomplete`) is an error; an allow-list
 * so an unseen spelling reads as an error, not a silent success.
 */
const CODEX_OK_STATUSES: ReadonlySet<string> = new Set(["completed", "in_progress"])

function normalizeSingleRecordTool(
  payload: Record<string, unknown>,
  timestamp: string,
  sessionId: string,
): Message | undefined {
  const type = typeof payload.type === "string" ? payload.type : "tool"
  const callId =
    typeof payload.call_id === "string" && payload.call_id.length > 0 ? payload.call_id : `${type}:${timestamp}`
  const name = stringOr(payload.name, type)
  const input = stripPayload(payload, ["type", "call_id", "status"])
  const output = stripPayload(payload, ["type", "call_id"])
  // `status` is the call's verdict (metadata, so stripped from `input`). The
  // `*_output` records carry none — `{type, id, call_id, output}`; Codex puts it
  // on `item_completed.item.status`, which this parser doesn't read.
  const status = payload.status
  const isError = typeof status === "string" && !CODEX_OK_STATUSES.has(status)
  return {
    role: "assistant",
    timestamp,
    sessionId,
    blocks: [
      { type: "tool_call", callId, name, input },
      { type: "tool_result", callId, output, isError },
    ],
  }
}

function reasoningTextFromItem(item: Record<string, unknown>): string {
  const content = textFromReasoningValue(item.content)
  if (content.length > 0) return content
  const text = typeof item.text === "string" ? item.text : ""
  if (text.length > 0) return text
  return textFromReasoningValue(item.summary)
}

function textFromReasoningValue(value: unknown): string {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return ""
  const parts: string[] = []
  for (const entry of value) {
    if (typeof entry === "string") {
      parts.push(entry)
      continue
    }
    if (!isObject(entry)) continue
    const text = typeof entry.text === "string" ? entry.text : ""
    if (text.length > 0) parts.push(text)
  }
  return parts.join("")
}

function stripPayload(payload: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (!keys.includes(key)) out[key] = value
  }
  return out
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function parseTimestampMs(value: string): number | null {
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}
