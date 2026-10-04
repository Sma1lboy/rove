/**
 * pi-family session JSONL → `Message[]`. The format is versioned and
 * append-only (`docs/session-format.md` in the installed package); only
 * `message` records carry conversation.
 *
 * The `id`/`parentId` tree is deliberately NOT walked: readers want FILE
 * order, which is the order the session happened.
 *
 * Uses the append-aware cache: `readHistory` polls every ~2.5s and a long
 * session is tens of MB.
 */

import type { ContentBlock } from "@/types/content"
import type { EngineHistory, EngineUsageSnapshot, Message } from "@/types/engine"
import { isJsonlLineWithinBound } from "../file-bounds"
import { createAppendParseCache, sortByTimestamp } from "../history-cache"
import { normalizePiContent } from "./normalize"

/** `toolResult` is part of the model's tool loop, so assistant-side; synthetic
 *  roles (`custom`, `hookMessage`, `bashExecution`) are extension state, dropped. */
const ROLE_MAP: Readonly<Record<string, Message["role"]>> = {
  user: "user",
  assistant: "assistant",
  toolResult: "assistant",
  system: "system",
}

interface PiParseState {
  readonly messages: readonly Message[]
  readonly usage: EngineUsageSnapshot | undefined
}

const emptyState: PiParseState = { messages: [], usage: undefined }

const cache = createAppendParseCache<PiParseState, string>({
  initial: () => emptyState,
  parseChunk: foldChunk,
})

export function parsePiSessionRaw(filePath: string, raw: string, sessionId: string): EngineHistory {
  const state = cache(filePath, raw, sessionId)
  return { messages: sortByTimestamp(state.messages), ...(state.usage ? { usageMetrics: state.usage } : {}) }
}

/** Uncached; exported for tests. */
export function parsePiSessionJsonl(raw: string, sessionId: string): readonly Message[] {
  return sortByTimestamp(foldChunk(raw, emptyState, sessionId).messages)
}

function foldChunk(chunk: string, prev: PiParseState, sessionId: string): PiParseState {
  let messages: Message[] | undefined
  let usage = prev.usage

  for (const line of chunk.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || !isJsonlLineWithinBound(trimmed)) continue
    let record: unknown
    try {
      record = JSON.parse(trimmed)
    } catch {
      continue /* a torn line from a live append — the next poll reads it whole */
    }
    if (!record || typeof record !== "object") continue
    const entry = record as Record<string, unknown>
    if (entry.type !== "message") continue
    const message = entry.message
    if (!message || typeof message !== "object") continue
    const m = message as Record<string, unknown>
    const role = typeof m.role === "string" ? ROLE_MAP[m.role] : undefined
    if (!role) continue

    // A tool result is its own MESSAGE here (call id and error flag OUTSIDE
    // the content array) → one `tool_result` block carrying the whole content.
    const blocks: ContentBlock[] =
      m.role === "toolResult"
        ? [
            {
              type: "tool_result",
              callId: typeof m.toolCallId === "string" ? m.toolCallId : "",
              output: m.content,
              isError: m.isError === true,
            },
          ]
        : normalizePiContent(m.content)
    if (blocks.length === 0) continue

    const usageSnapshot = role === "assistant" ? usageFromMessage(m) : undefined
    if (usageSnapshot) usage = usageSnapshot
    if (!messages) messages = [...prev.messages]
    messages.push({
      role,
      blocks,
      timestamp: timestampOf(entry, m),
      sessionId,
      ...(usageSnapshot ? { usage: usageSnapshot } : {}),
    })
  }

  return messages ? { messages, usage } : { messages: prev.messages, usage }
}

/** The record's `timestamp` is ISO; the message's is epoch ms. */
function timestampOf(entry: Record<string, unknown>, message: Record<string, unknown>): string {
  if (typeof entry.timestamp === "string") return entry.timestamp
  const ms = typeof message.timestamp === "number" ? message.timestamp : undefined
  return ms === undefined ? new Date(0).toISOString() : new Date(ms).toISOString()
}

/** A provider reporting no counters yields `undefined` ("not reported"), never zeros. */
function usageFromMessage(message: Record<string, unknown>): EngineUsageSnapshot | undefined {
  const usage = message.usage
  if (!usage || typeof usage !== "object") return undefined
  const u = usage as Record<string, unknown>
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0)
  const input = u.input ?? u.input_tokens
  const output = u.output ?? u.output_tokens
  if (input === undefined && output === undefined) return undefined
  const cacheRead = u.cacheRead ?? u.cache_read_input_tokens
  const cacheWrite = u.cacheWrite ?? u.cache_creation_input_tokens
  return {
    input_tokens: num(input),
    output_tokens: num(output),
    ...(typeof cacheRead === "number" ? { cache_read_input_tokens: cacheRead } : {}),
    ...(typeof cacheWrite === "number" ? { cache_creation_input_tokens: cacheWrite } : {}),
  }
}
