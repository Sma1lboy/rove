/**
 * Codex's {@link EngineTurnReader} — per-turn telemetry lifted out of a
 * rollout JSONL.
 *
 * Codex records turn boundaries EXPLICITLY, so this needs none of the
 * inference Claude's reader does: `event_msg/task_started` opens a turn and
 * carries the `turn_id` codex assigns it, `event_msg/task_complete` closes the
 * same id, and `turn_context` names the model that ran it. That `turn_id` is
 * the vendor-stable dedupe key {@link AgentTurn.id} asks for — the same turn
 * yields the same id on every re-read, with no "last assistant message"
 * heuristic. A turn with no `task_complete` is still running (or was
 * interrupted) and is not emitted: the verb promises COMPLETED turns.
 *
 * Usage is summed from `token_count.last_token_usage`, which is the delta for
 * ONE model request — a turn holding a tool loop writes several. The sibling
 * `total_token_usage` is session-cumulative, so summing THAT would charge every
 * turn for the whole session up to it. Summing the per-request deltas inside a
 * turn reproduces the cumulative delta exactly (verified against a 5-turn
 * rollout from codex-cli 0.149.1: turn 1's seven deltas sum to 217178, the
 * cumulative total standing at its `task_complete`). `token_count` carries no
 * `turn_id`, so it attributes to the turn that is currently open.
 *
 * Pure (string in, records out) so it unit-tests without a filesystem; the
 * bounded file read lives in the reader wrapper below.
 */

import type { AgentTurn } from "../agent-turn.ts"
import { isJsonlLineWithinBound, readTextFileBounded } from "../file-bounds.ts"
import { codexUsageToSnapshot } from "./usage.ts"

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0
}

interface Draft {
  turnId: string
  startedAt: number
  model?: string
  contextWindow?: number
  /** Running sum of this turn's per-request `last_token_usage` fields. */
  input: number
  cachedInput: number
  output: number
  sawUsage: boolean
}

/**
 * Parse a Codex rollout into completed turns, oldest-first.
 * `fallbackSessionId` names the session when the rollout has no `session_meta`
 * header (a file opened mid-stream). Exported for unit tests; production
 * callers use {@link readCodexTurns}.
 */
export function parseCodexTurns(raw: string, fallbackSessionId = ""): AgentTurn[] {
  const out: AgentTurn[] = []
  const drafts = new Map<string, Draft>()
  let sessionId = fallbackSessionId
  let openTurnId = ""

  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || !isJsonlLineWithinBound(trimmed)) continue
    let record: unknown
    try {
      record = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isObject(record)) continue
    const payload = isObject(record.payload) ? record.payload : undefined
    if (!payload) continue
    const at = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : Number.NaN

    if (record.type === "session_meta") {
      const id = payload.session_id ?? payload.id
      if (typeof id === "string" && id) sessionId = id
      continue
    }

    // `turn_context` is the only record naming the model, and it may land
    // before or after its `task_started` — key it by turn_id, never by "open".
    if (record.type === "turn_context") {
      const turnId = typeof payload.turn_id === "string" ? payload.turn_id : ""
      const model = typeof payload.model === "string" ? payload.model : ""
      if (!turnId || !model) continue
      const draft = drafts.get(turnId)
      if (draft) draft.model = model
      else drafts.set(turnId, { ...emptyDraft(turnId, Number.NaN), model })
      continue
    }

    if (record.type !== "event_msg") continue

    if (payload.type === "task_started") {
      const turnId = typeof payload.turn_id === "string" ? payload.turn_id : ""
      if (!turnId) continue
      const existing = drafts.get(turnId)
      // `started_at` is epoch SECONDS; the record's own ISO timestamp is the
      // millisecond-precision answer `AgentTurn` asks for, so prefer it.
      const startedAt = Number.isFinite(at) ? at : num(payload.started_at) * 1000
      drafts.set(turnId, { ...emptyDraft(turnId, startedAt), ...(existing?.model ? { model: existing.model } : {}) })
      if (typeof payload.model_context_window === "number") {
        const d = drafts.get(turnId)
        if (d) d.contextWindow = payload.model_context_window
      }
      openTurnId = turnId
      continue
    }

    if (payload.type === "token_count") {
      const draft = drafts.get(openTurnId)
      if (!draft) continue
      const info = isObject(payload.info) ? payload.info : undefined
      const last = info && isObject(info.last_token_usage) ? info.last_token_usage : undefined
      if (!last) continue
      draft.input += num(last.input_tokens)
      draft.cachedInput += num(last.cached_input_tokens)
      draft.output += num(last.output_tokens)
      draft.sawUsage = true
      if (draft.contextWindow === undefined && typeof info?.model_context_window === "number") {
        draft.contextWindow = info.model_context_window
      }
      continue
    }

    if (payload.type !== "task_complete") continue
    const turnId = typeof payload.turn_id === "string" ? payload.turn_id : ""
    const draft = turnId ? drafts.get(turnId) : undefined
    // A `task_complete` with no opener is a rollout we started reading
    // mid-turn — there is no start time to attribute, so skip it rather than
    // emit a turn stamped with a guess.
    if (!draft || !Number.isFinite(draft.startedAt)) continue
    drafts.delete(turnId)
    if (openTurnId === turnId) openTurnId = ""
    const endedAt = Number.isFinite(at) ? at : num(payload.completed_at) * 1000
    const usage = draft.sawUsage
      ? codexUsageToSnapshot(
          { input_tokens: draft.input, cached_input_tokens: draft.cachedInput, output_tokens: draft.output },
          draft.contextWindow !== undefined ? { contextWindowTokens: draft.contextWindow } : {},
        )
      : undefined
    out.push({
      id: draft.turnId,
      sessionId,
      ...(draft.model ? { model: draft.model } : {}),
      startedAt: draft.startedAt,
      endedAt,
      ...(usage ? { usage } : {}),
    })
  }
  return out
}

function emptyDraft(turnId: string, startedAt: number): Draft {
  return { turnId, startedAt, input: 0, cachedInput: 0, output: 0, sawUsage: false }
}

/** Codex's {@link import("../agent-turn.ts").EngineTurnReader}: bounded file
 *  read + {@link parseCodexTurns}. Never throws — an unreadable rollout
 *  yields no turns. */
export async function readCodexTurns(transcriptPath: string): Promise<readonly AgentTurn[]> {
  try {
    const raw = await readTextFileBounded(transcriptPath)
    return parseCodexTurns(raw)
  } catch {
    return []
  }
}
