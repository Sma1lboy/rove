/**
 * Claude JSONL → Message[]. Append-caching is sound because `parseJsonl` is
 * line-local: `parse(prefix) ++ parse(appended)` equals `parse(whole)`, and
 * `sortByTimestamp` reorders the same objects, keeping identities stable.
 */

import type { Message } from "@/types/engine"
import { isJsonlLineWithinBound } from "../file-bounds"
import { createAppendParseCache, sortByTimestamp } from "../history-cache"
import { isObject } from "../json-hooks.ts"
import { normalizeClaudeContent } from "./normalize"
import { isClaudeCommandBreadcrumb, isSyntheticClaudeRecord } from "./synthetic"

const cache = createAppendParseCache<readonly Message[], string>({
  initial: () => [],
  parseChunk: (chunk, prev, sessionId) => {
    const added = parseJsonl(chunk, sessionId)
    return added.length ? prev.concat(added) : prev
  },
})

/** `raw` is the full current file; an append-only change reuses the cached prefix. */
export function parseSessionRaw(filePath: string, raw: string, sessionId: string): readonly Message[] {
  return sortByTimestamp(cache(filePath, raw, sessionId))
}

/** Role+content records only. Must stay line-local — the append-cache relies on it. */
export function parseJsonl(raw: string, sessionId: string): Message[] {
  const out: Message[] = []
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // Skip mega-lines before JSON.parse can hang on them.
    if (!isJsonlLineWithinBound(trimmed)) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isObject(parsed)) continue
    const msg = extractMessage(parsed, sessionId)
    if (msg) out.push(msg)
  }
  return out
}

function extractMessage(record: Record<string, unknown>, fallbackSessionId: string): Message | null {
  // Usually { type, message: { role, content }, timestamp, sessionId }; older
  // records put role+content at the top level. Synthetic rows (flagged on the
  // OUTER record) are dropped as Claude's own title path does, or a session
  // opening with a slash command auto-titles from boilerplate.
  if (isSyntheticClaudeRecord(record)) return null

  const inner = isObject(record.message) ? (record.message as Record<string, unknown>) : record

  const role = inner.role
  if (role !== "user" && role !== "assistant" && role !== "system") return null

  if (!("content" in inner)) return null
  // Empty blocks are kept: "no renderable content" differs from "no message" (null).
  const blocks = normalizeClaudeContent(inner.content)
  // Un-flagged `<command-name>…` breadcrumb before the real prompt; not a title.
  if (role === "user" && isClaudeCommandBreadcrumb(blocks)) return null

  const ts = typeof record.timestamp === "string" ? (record.timestamp as string) : new Date().toISOString()
  const sid = typeof record.sessionId === "string" ? (record.sessionId as string) : fallbackSessionId

  const usage = extractUsage(inner.usage)
  return usage
    ? { role, blocks, timestamp: ts, sessionId: sid, usage }
    : { role, blocks, timestamp: ts, sessionId: sid }
}

/**
 * Session usage folded by assistant `message.id`, straight from the raw JSONL.
 *
 * Claude Code writes one record per assistant content block (thinking,
 * tool_use, text) and stamps the SAME `message.usage` on every record of a
 * message, so summing usage per RECORD multiplies a message's cost by its
 * block count — the exact quirk {@link import("./turns").parseClaudeTurns}
 * already folds per turn. This folds it session-wide: one usage per id.
 * Records with no id (older transcript shapes) each get a distinct key, so
 * they still count exactly once rather than collapsing together.
 *
 * `last` is the usage of the newest record by timestamp (file order breaks
 * ties and covers records without a timestamp) — the final, largest prompt,
 * which the snapshot reports as the session's context window.
 */
export function foldSessionUsage(raw: string): {
  byMessage: Map<string, NonNullable<Message["usage"]>>
  last: NonNullable<Message["usage"]> | undefined
} {
  const byMessage = new Map<string, NonNullable<Message["usage"]>>()
  let last: NonNullable<Message["usage"]> | undefined
  let lastAt = Number.NEGATIVE_INFINITY
  let anon = 0
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || !isJsonlLineWithinBound(trimmed)) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isObject(parsed) || isSyntheticClaudeRecord(parsed)) continue
    const inner = isObject(parsed.message) ? (parsed.message as Record<string, unknown>) : parsed
    if (inner.role !== "assistant") continue
    const usage = extractUsage(inner.usage)
    if (!usage) continue
    const id = typeof inner.id === "string" && inner.id ? inner.id : `#anon-${anon++}`
    byMessage.set(id, usage)
    // Newest by timestamp is the context prompt; a record with no parseable
    // timestamp folds into the running max so the last one in file order wins.
    const at = typeof parsed.timestamp === "string" ? Date.parse(parsed.timestamp) : Number.NaN
    const ts = Number.isFinite(at) ? at : lastAt
    if (ts >= lastAt) {
      last = usage
      lastAt = ts
    }
  }
  return { byMessage, last }
}

function extractUsage(v: unknown): Message["usage"] {
  if (!isObject(v)) return undefined
  const inTok = typeof v.input_tokens === "number" ? v.input_tokens : undefined
  const outTok = typeof v.output_tokens === "number" ? v.output_tokens : undefined
  if (inTok === undefined || outTok === undefined) return undefined
  const cacheRead = typeof v.cache_read_input_tokens === "number" ? v.cache_read_input_tokens : undefined
  const cacheCreate = typeof v.cache_creation_input_tokens === "number" ? v.cache_creation_input_tokens : undefined
  return {
    input_tokens: inTok,
    output_tokens: outTok,
    ...(cacheRead !== undefined ? { cache_read_input_tokens: cacheRead } : {}),
    ...(cacheCreate !== undefined ? { cache_creation_input_tokens: cacheCreate } : {}),
  }
}
