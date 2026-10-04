/**
 * Claude Code's {@link EngineTurnReader}: per-turn telemetry from its JSONL.
 *
 * A `user` record with real prompt content opens a turn; following `assistant`
 * records belong to it until the next such `user` record. Tool-result `user`
 * records are the engine feeding itself mid-turn and open nothing.
 *
 * Usage is summed per assistant MESSAGE id, not per record: Claude repeats the
 * SAME `message.usage` on each content-block record, so summing records
 * multiplies cost by block count. `model` is the last one seen.
 */

import type { AgentTurn } from "../agent-turn.ts"
import { isJsonlLineWithinBound, readTextFileBounded } from "../file-bounds.ts"
import { isSyntheticClaudeRecord } from "./synthetic.ts"

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** A human prompt: non-empty string content, or not purely `tool_result` blocks. */
function opensTurn(content: unknown): boolean {
  if (typeof content === "string") return content.trim().length > 0
  if (!Array.isArray(content)) return false
  return content.some((b) => !isObject(b) || b.type !== "tool_result")
}

interface Usage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

interface Draft {
  id: string
  sessionId: string
  model?: string
  startedAt: number
  endedAt: number
  /** Per assistant `message.id` — Claude repeats one usage across a message's records. */
  usageByMessage: Map<string, Usage>
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0
}

function readUsage(v: unknown): Usage | undefined {
  if (!isObject(v)) return undefined
  return {
    input_tokens: num(v.input_tokens),
    output_tokens: num(v.output_tokens),
    cache_read_input_tokens: num(v.cache_read_input_tokens),
    cache_creation_input_tokens: num(v.cache_creation_input_tokens),
  }
}

function finish(draft: Draft): AgentTurn | null {
  // No assistant reply (interrupted early) → no id, nothing to attribute.
  if (!draft.id) return null
  const totals: Usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  }
  for (const u of draft.usageByMessage.values()) {
    totals.input_tokens += u.input_tokens
    totals.output_tokens += u.output_tokens
    totals.cache_read_input_tokens += u.cache_read_input_tokens
    totals.cache_creation_input_tokens += u.cache_creation_input_tokens
  }
  return {
    id: draft.id,
    sessionId: draft.sessionId,
    ...(draft.model ? { model: draft.model } : {}),
    startedAt: draft.startedAt,
    endedAt: draft.endedAt,
    ...(draft.usageByMessage.size > 0 ? { usage: totals } : {}),
  }
}

/** Completed turns, oldest-first. `fallbackSessionId` covers records omitting `sessionId`. */
export function parseClaudeTurns(raw: string, fallbackSessionId = ""): AgentTurn[] {
  const out: AgentTurn[] = []
  let draft: Draft | null = null

  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || !isJsonlLineWithinBound(trimmed)) continue
    let record: unknown
    try {
      record = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isObject(record) || isSyntheticClaudeRecord(record)) continue

    const inner = isObject(record.message) ? record.message : record
    const at = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : Number.NaN
    if (!Number.isFinite(at)) continue
    const sessionId = typeof record.sessionId === "string" ? record.sessionId : fallbackSessionId

    if (inner.role === "user") {
      if (!opensTurn(inner.content)) continue
      if (draft) {
        const done = finish(draft)
        if (done) out.push(done)
      }
      draft = { id: "", sessionId, startedAt: at, endedAt: at, usageByMessage: new Map() }
      continue
    }
    if (inner.role !== "assistant" || !draft) continue

    draft.endedAt = at
    if (typeof inner.model === "string") draft.model = inner.model
    const messageId = typeof inner.id === "string" ? inner.id : ""
    // Id = LAST assistant message: stable across re-reads, unique per turn.
    if (messageId) draft.id = messageId
    const usage = readUsage(inner.usage)
    if (usage && messageId) draft.usageByMessage.set(messageId, usage)
  }

  // The trailing draft counts: this read is triggered on Stop. A still-running
  // turn re-reads next time and dedupes on the same message id.
  if (draft) {
    const done = finish(draft)
    if (done) out.push(done)
  }
  return out
}

/** Bounded read + {@link parseClaudeTurns}. Never throws; unreadable → no turns. */
export async function readClaudeTurns(transcriptPath: string): Promise<readonly AgentTurn[]> {
  try {
    const raw = await readTextFileBounded(transcriptPath)
    return parseClaudeTurns(raw)
  } catch {
    return []
  }
}
