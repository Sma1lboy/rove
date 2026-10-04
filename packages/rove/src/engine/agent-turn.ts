/**
 * `AgentTurn` — engine-owned per-turn record (model, duration, tokens). Only
 * the engine adapter produces one, from the vendor transcript; neutral layers
 * never parse vendor files. No `taskId`/`tabId`: the engine knows no tasks;
 * the daemon joins them (`agent-turns-store.ts`). Exposed as `readTurns` on
 * the registry entry.
 */

import type { EngineUsageSnapshot } from "@/types/engine"

export interface AgentTurn {
  /** Dedupe key across re-reads (every Stop re-reads from the top): the SAME
   *  turn must yield the SAME id. Claude uses the last assistant `message.id`. */
  readonly id: string
  /** The engine session this turn belongs to (claude's `sessionId`). */
  readonly sessionId: string
  /** Model that ran the turn, as the vendor names it; absent when unrecorded. */
  readonly model?: string
  /** Turn start (epoch ms) — when the user's prompt entered the transcript. */
  readonly startedAt: number
  /** Turn end (epoch ms) — the last assistant record of the turn. */
  readonly endedAt: number
  /** Token usage for the turn, summed across its assistant messages. */
  readonly usage?: EngineUsageSnapshot
}

/**
 * Completed turns from ONE transcript (the path the hook reported),
 * oldest-first. Never throws: a missing/oversize/unparseable file yields `[]`
 * so telemetry can't break the hook path.
 */
export type EngineTurnReader = (transcriptPath: string) => Promise<readonly AgentTurn[]>
