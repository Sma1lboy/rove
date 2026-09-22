/**
 * `worktree.changes` wire contract: map type, parser, re-render equality.
 * Its own module because this payload carries TWO facts per key — `changes`
 * counts and `unreadable` paths — and collapsing them makes an unreadable
 * worktree look clean.
 */

import { type WorktreeChanges, sameWorktreeChanges } from "../tui/panes/sidebar/worktree-changes.ts"

/** Path → counts, or `null` for a worktree the daemon TRACKED but could not
 *  read. Absent means "not collected" (remote project, just-created task) and
 *  draws no chip; `null` draws the unknown mark. */
export type WorktreeChangesMap = ReadonlyMap<string, WorktreeChanges | null>

/**
 * Parse a `worktree.changes` payload. `null` for a malformed one — ignore the
 * event rather than clobber a good map. Exported for unit tests.
 */
export function parseWorktreeChangesPayload(payload: unknown): Map<string, WorktreeChanges | null> | null {
  const changes = (payload as { changes?: unknown } | undefined)?.changes
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return null
  const map = new Map<string, WorktreeChanges | null>()
  for (const [path, value] of Object.entries(changes as Record<string, unknown>)) {
    const counts = value as { added?: unknown; deleted?: unknown; behind?: unknown; ahead?: unknown } | undefined
    if (typeof counts?.added !== "number" || typeof counts.deleted !== "number") return null
    // `behind`/`ahead` are additive: absent → chip not drawn, never a fabricated zero.
    map.set(path, {
      added: counts.added,
      deleted: counts.deleted,
      ...(typeof counts.behind === "number" ? { behind: counts.behind } : {}),
      ...(typeof counts.ahead === "number" ? { ahead: counts.ahead } : {}),
    })
  }
  // Additive field. Mapped to `null`, NOT left absent (which draws as clean).
  const unreadable = (payload as { unreadable?: unknown } | undefined)?.unreadable
  if (Array.isArray(unreadable)) {
    for (const path of unreadable) if (typeof path === "string" && path.length > 0) map.set(path, null)
  }
  return map
}

/**
 * Entry-wise equality, so an unchanged republish (bus replay on reconnect)
 * doesn't re-render every sidebar row. Exported for unit tests.
 */
export function sameWorktreeChangesMap(a: WorktreeChangesMap, b: WorktreeChangesMap): boolean {
  if (a.size !== b.size) return false
  for (const [path, counts] of a) {
    if (!b.has(path)) return false
    if (!sameWorktreeChanges(counts, b.get(path) ?? null)) return false
  }
  return true
}
