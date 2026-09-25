/**
 * Bob Shell's {@link EngineHistoryReader}, read out of its SQLite store.
 *
 * Three things about Bob's schema are not what the column names suggest, and
 * each was measured against bob 2.0.5:
 *
 *   - `tasks.directory` is EMPTY on every row (0/42 populated); the working
 *     directory a session actually ran in lives in `tasks.env` as
 *     `$.workspace`. Keying on `directory` silently finds nothing.
 *   - A `tool` message's `id` is its OWN message id, never the id of the
 *     `toolCalls` entry it answers (0/104 matched). Results are therefore
 *     paired with calls POSITIONALLY: the tool messages following an
 *     assistant turn answer its calls in order.
 *   - `messages.data.content` is a plain string for every role, not a block
 *     array — the structure lives beside it in `toolCalls` / `toolUsage`.
 *
 * `system` rows are Bob's own role definition (80 KB of prompt); they are not
 * conversation and are dropped rather than rendered.
 */

import type { ContentBlock, EngineUsageSnapshot, Message } from "@/types/engine"
import type { EngineHistoryReader } from "../registry.ts"
import { bobQuery } from "./db.ts"

interface TaskRow {
  id: string
  updated_at: number
}
interface MessageRow {
  role: string
  data: string
  created_at: number
}
interface CostRow {
  costs: string | null
}

/** Bob stores epoch milliseconds; Message.timestamp is ISO-8601. */
function iso(epochMs: number): string {
  const n = Number(epochMs)
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : new Date(0).toISOString()
}

function textBlock(content: unknown): ContentBlock[] {
  const text = typeof content === "string" ? content : ""
  return text.trim() ? [{ type: "text", text }] : []
}

/** One Bob row → neutral blocks, plus the call ids an assistant turn opened. */
function blocksFor(role: string, data: Record<string, unknown>, pendingCalls: string[]): readonly ContentBlock[] {
  if (role === "assistant") {
    const blocks: ContentBlock[] = [...textBlock(data.content)]
    const calls = Array.isArray(data.toolCalls) ? data.toolCalls : []
    for (const raw of calls) {
      const call = raw as { id?: unknown; name?: unknown; arguments?: unknown }
      const callId = String(call.id ?? "")
      pendingCalls.push(callId)
      blocks.push({ type: "tool_call", callId, name: String(call.name ?? "tool"), input: call.arguments })
    }
    return blocks
  }
  if (role === "tool") {
    // Positional pairing — see the module doc.
    const callId = pendingCalls.shift() ?? ""
    return [{ type: "tool_result", callId, output: data.content, isError: false }]
  }
  return textBlock(data.content)
}

/** Bob's roles → the neutral three. A tool result is the user's turn, as in the Anthropic shape. */
function neutralRole(role: string): Message["role"] | null {
  if (role === "assistant") return "assistant"
  if (role === "user" || role === "tool") return "user"
  return null // `system` — Bob's role definition, not conversation.
}

async function listSessionIdsForWorktree(worktree: string, home?: string): Promise<readonly string[]> {
  const rows = await bobQuery<TaskRow>(
    "SELECT id, updated_at FROM tasks WHERE json_extract(env, '$.workspace') = ? ORDER BY created_at ASC",
    [worktree],
    home,
  )
  return rows.map((r) => String(r.id))
}

async function readHistory(sessionId: string, home?: string): Promise<readonly Message[]> {
  const rows = await bobQuery<MessageRow>(
    "SELECT role, data, created_at FROM messages WHERE task_id = ? ORDER BY created_at ASC, rowid ASC",
    [sessionId],
    home,
  )
  const out: Message[] = []
  const pendingCalls: string[] = []
  for (const row of rows) {
    const role = neutralRole(String(row.role))
    if (!role) continue
    let data: Record<string, unknown>
    try {
      data = JSON.parse(row.data) as Record<string, unknown>
    } catch {
      continue
    }
    const blocks = blocksFor(String(row.role), data, pendingCalls)
    if (blocks.length === 0) continue
    out.push({ role, blocks, timestamp: iso(row.created_at), sessionId })
  }
  return out
}

/**
 * Bob keeps a session-level cost record, which is exactly this snapshot's
 * shape — so Rove reports its tokens without a per-turn transcript to parse.
 */
async function readUsageSnapshot(sessionId: string, home?: string): Promise<EngineUsageSnapshot | undefined> {
  const [row] = await bobQuery<CostRow>("SELECT costs FROM tasks WHERE id = ?", [sessionId], home)
  if (!row?.costs) return undefined
  let costs: Record<string, unknown>
  try {
    costs = JSON.parse(row.costs) as Record<string, unknown>
  } catch {
    return undefined
  }
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
  const input = num(costs.input)
  const output = num(costs.output)
  if (input === undefined && output === undefined) return undefined
  return {
    input_tokens: input ?? 0,
    output_tokens: output ?? 0,
    ...(num(costs.cacheRead) === undefined ? {} : { cache_read_input_tokens: num(costs.cacheRead) }),
    ...(num(costs.cacheWrite) === undefined ? {} : { cache_creation_input_tokens: num(costs.cacheWrite) }),
    ...(num(costs.contextTokens) === undefined ? {} : { context_tokens: num(costs.contextTokens) }),
  }
}

export function bobHistoryReaderFor(home?: string): EngineHistoryReader {
  return {
    listSessionIdsForWorktree: (worktree) => listSessionIdsForWorktree(worktree, home),
    readHistory: (sessionId) => readHistory(sessionId, home),
    readUsageSnapshot: (sessionId) => readUsageSnapshot(sessionId, home),
    // One database, no per-session file: there is nothing to hand another agent.
    transcriptPath: async () => null,
    async latestTranscriptMtimeForWorktree(worktree) {
      const rows = await bobQuery<{ last: number | null }>(
        "SELECT max(updated_at) AS last FROM tasks WHERE json_extract(env, '$.workspace') = ?",
        [worktree],
        home,
      )
      const last = Number(rows[0]?.last ?? 0)
      return Number.isFinite(last) ? last : 0
    },
  }
}

export const bobHistoryReader: EngineHistoryReader = bobHistoryReaderFor()
