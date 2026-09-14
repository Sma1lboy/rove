/**
 * pi-family session JSONL → `Message[]`.
 *
 * The on-disk format is documented as versioned and append-only
 * (`docs/session-format.md` in the installed package): one JSON object per
 * line, `type` discriminating the record. Only `message` records carry
 * conversation; `title`, `model_change`, `thinking_level_change` and `custom`
 * records are metadata Rove reads elsewhere or not at all.
 *
 * The tree structure (`id`/`parentId`) is deliberately NOT walked: every
 * reader of this module wants the linear transcript in FILE order, which is
 * the order the session actually happened — the same choice claude's reader
 * makes for its own branched store.
 *
 * Parsing reuses the append-aware cache (`../history-cache.ts`) because
 * `readHistory` is polled (~2.5s) and a long session is tens of MB of JSONL —
 * re-parsing the unchanged prefix every tick was exactly what that cache
 * exists to prevent.
 */

import type { ContentBlock } from "@/types/content"
import type { EngineHistory, EngineUsageSnapshot, Message } from "@/types/engine"
import { isJsonlLineWithinBound } from "../file-bounds"
import { createAppendParseCache, sortByTimestamp } from "../history-cache"
import { normalizePiContent } from "./normalize"

/** Roles pi persists that belong in a transcript. `toolResult` is folded into
 *  the assistant side (it is part of the model's tool loop, not a user turn),
 *  and pi's synthetic roles (`custom`, `hookMessage`, `bashExecution`) are
 *  dropped: they are extension state, not conversation. */
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

/** Cached parse of a session file's full current contents. */
export function parsePiSessionRaw(filePath: string, raw: string, sessionId: string): EngineHistory {
  const state = cache(filePath, raw, sessionId)
  return { messages: sortByTimestamp(state.messages), ...(state.usage ? { usageMetrics: state.usage } : {}) }
}

/** Uncached message-only parse. Exported for unit testing. */
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

    // A tool result is its own MESSAGE in this format (role `toolResult`,
    // with the call id and the error flag OUTSIDE the content array), so it
    // becomes one neutral `tool_result` block whose output is the whole
    // content — the shape the chat renderer pairs with its `tool_call`.
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

/** ISO-8601, which is what the neutral shape carries. The record's own
 *  `timestamp` is ISO; the message's is epoch ms. */
function timestampOf(entry: Record<string, unknown>, message: Record<string, unknown>): string {
  if (typeof entry.timestamp === "string") return entry.timestamp
  const ms = typeof message.timestamp === "number" ? message.timestamp : undefined
  return ms === undefined ? new Date(0).toISOString() : new Date(ms).toISOString()
}

/**
 * Per-message token usage, in the neutral shape the cost dashboard reads. pi
 * families report Anthropic-style counters on the assistant message; a
 * provider that reports none yields `undefined` ("not reported"), never a
 * zeroed snapshot.
 */
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
