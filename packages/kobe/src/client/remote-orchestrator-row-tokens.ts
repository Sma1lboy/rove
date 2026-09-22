/**
 * The `task.tokens` channel's wire contract: plugin-written row labels, keyed
 * by task id (see `kobe-daemon/daemon/row-tokens.ts`).
 *
 * Its own module for the reason `remote-orchestrator-worktree-changes.ts` has
 * one: the payload needs parsing and a value-equality gate, and neither
 * belongs in the events dispatcher.
 *
 * Validated field by field rather than cast. These rows are written by THIRD
 * PARTY code — a plugin is the one publisher in the system Rove does not
 * ship — so a malformed token must be dropped here, not rendered as
 * `undefined` on somebody's sidebar.
 */

import { type RowToken, isRowTokenTone } from "@sma1lboy/kobe-daemon/daemon/row-tokens"

export type { RowToken }

/** taskId → its live tokens. */
export type RowTokenMap = ReadonlyMap<string, readonly RowToken[]>

function parseToken(raw: unknown): RowToken | null {
  if (!raw || typeof raw !== "object") return null
  const t = raw as Record<string, unknown>
  if (typeof t.source !== "string" || typeof t.key !== "string") return null
  if (typeof t.text !== "string" || t.text.length === 0) return null
  if (typeof t.expiresAt !== "number" || !Number.isFinite(t.expiresAt)) return null
  return {
    source: t.source,
    key: t.key,
    text: t.text,
    ...(isRowTokenTone(t.tone) ? { tone: t.tone } : {}),
    expiresAt: t.expiresAt,
  }
}

/** Parse the channel payload, or `null` when it is not a token map at all. */
export function parseRowTokensPayload(payload: unknown): RowTokenMap | null {
  const tokens = (payload as { tokens?: unknown } | undefined)?.tokens
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) return null
  const out = new Map<string, readonly RowToken[]>()
  for (const [taskId, list] of Object.entries(tokens as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue
    const parsed = list.map(parseToken).filter((token): token is RowToken => token !== null)
    if (parsed.length > 0) out.set(taskId, parsed)
  }
  return out
}

/** Value equality, so an unchanged republish (the bus replays on every
 *  reconnect) does not swap the map reference and re-render every row. */
export function sameRowTokenMap(a: RowTokenMap, b: RowTokenMap): boolean {
  if (a.size !== b.size) return false
  for (const [taskId, left] of a) {
    const right = b.get(taskId)
    if (!right || right.length !== left.length) return false
    for (const [i, token] of left.entries()) {
      const other = right[i]
      if (
        !other ||
        other.source !== token.source ||
        other.key !== token.key ||
        other.text !== token.text ||
        other.tone !== token.tone ||
        other.expiresAt !== token.expiresAt
      )
        return false
    }
  }
  return true
}

/** The tokens a row should draw right now — expired ones dropped. */
export function liveRowTokens(map: RowTokenMap | undefined, taskId: string, now: number): readonly RowToken[] {
  const tokens = map?.get(taskId)
  if (!tokens || tokens.length === 0) return []
  return tokens.filter((token) => token.expiresAt > now)
}
