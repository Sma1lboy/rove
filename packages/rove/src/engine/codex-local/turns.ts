/**
 * Codex's {@link EngineTurnReader}: per-turn telemetry from a rollout JSONL.
 *
 * Turn boundaries are explicit: `task_started`/`task_complete` share a
 * codex-assigned `turn_id` (the stable dedupe key {@link AgentTurn.id} needs),
 * and `turn_context` names the model. Turns without `task_complete` aren't
 * emitted: the verb promises COMPLETED turns.
 *
 * Usage sums `token_count.last_token_usage` (one request's delta; a tool loop
 * writes several). `total_token_usage` is session-cumulative — summing it
 * overcharges. Verified on codex-cli 0.149.1: turn 1's seven deltas sum to
 * 217178, the cumulative total at its `task_complete`. `token_count` has no
 * `turn_id`, so it goes to the open turn.
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
 * Completed turns, oldest-first. `fallbackSessionId` applies when the rollout
 * has no `session_meta` (opened mid-stream).
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
      // Keep a model from an earlier `turn_context`.
      const model = drafts.get(turnId)?.model
      // `started_at` is epoch SECONDS; prefer the ms ISO timestamp.
      const startedAt = Number.isFinite(at) ? at : num(payload.started_at) * 1000
      drafts.set(turnId, {
        ...emptyDraft(turnId, startedAt),
        ...(model ? { model } : {}),
        ...(typeof payload.model_context_window === "number" ? { contextWindow: payload.model_context_window } : {}),
      })
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
    // No opener (read mid-turn): no start time, so skip rather than guess.
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

/** Never throws — an unreadable rollout yields no turns. */
export async function readCodexTurns(transcriptPath: string): Promise<readonly AgentTurn[]> {
  try {
    const raw = await readTextFileBounded(transcriptPath)
    return parseCodexTurns(raw)
  } catch {
    return []
  }
}
