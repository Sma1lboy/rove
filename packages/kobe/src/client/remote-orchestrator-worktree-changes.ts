/**
 * The `worktree.changes` channel's wire contract, in one place: its map type,
 * its payload parser, and the equality that gates a re-render.
 *
 * Split out of `remote-orchestrator-payloads.ts` because this is the one
 * channel whose payload carries TWO facts about the same key. `changes` holds
 * counts; `unreadable` names the worktrees the daemon tracked and could not
 * read. Absent-from-both and present-in-`unreadable` are different answers —
 * "not collected" draws no chip, "could not read" draws the unknown mark —
 * and collapsing them is what made an unreadable worktree arrive at every
 * pane looking exactly like a clean one. The rest of that module is
 * one-shape-per-channel parsers with no such distinction to keep straight.
 */

import { type WorktreeChanges, sameWorktreeChanges } from "../tui/panes/sidebar/worktree-changes.ts"

/**
 * Daemon-collected `+N −M` counts keyed by worktree path, from the
 * `worktree.changes` channel (one collector in the daemon
 * instead of per-pane git polling). `null` means "no daemon-collected
 * data": either the daemon predates the channel (absent from
 * `hello.capabilities`) or `init()` hasn't completed — the sidebar then
 * falls back to its local poller.
 */
/** Path → counts, or `null` for a worktree the daemon TRACKED but could not
 *  read. A `null` entry and an absent key are different facts: absent means
 *  "not collected" (remote project, just-created task) and draws no chip;
 *  `null` means the read failed and draws the unknown mark. */
export type WorktreeChangesMap = ReadonlyMap<string, WorktreeChanges | null>

/**
 * Parse a `worktree.changes` wire payload into a path→counts map.
 * Returns `null` for a malformed payload (the event is then ignored —
 * never clobber a good map with garbage). Exported for unit tests.
 */
export function parseWorktreeChangesPayload(payload: unknown): Map<string, WorktreeChanges | null> | null {
  const changes = (payload as { changes?: unknown } | undefined)?.changes
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return null
  const map = new Map<string, WorktreeChanges | null>()
  for (const [path, value] of Object.entries(changes as Record<string, unknown>)) {
    const counts = value as { added?: unknown; deleted?: unknown; behind?: unknown; ahead?: unknown } | undefined
    if (typeof counts?.added !== "number" || typeof counts.deleted !== "number") return null
    // `behind` and `ahead` are both additive: an older daemon omits them, and
    // the chip then simply does not draw — never a fabricated zero.
    map.set(path, {
      added: counts.added,
      deleted: counts.deleted,
      ...(typeof counts.behind === "number" ? { behind: counts.behind } : {}),
      ...(typeof counts.ahead === "number" ? { ahead: counts.ahead } : {}),
    })
  }
  // Worktrees the daemon tracked but could not read. Additive, so an older
  // daemon that omits the field simply contributes no unknowns. Mapped to
  // `null` — NOT left absent, which the row would draw as a clean chip.
  const unreadable = (payload as { unreadable?: unknown } | undefined)?.unreadable
  if (Array.isArray(unreadable)) {
    for (const path of unreadable) if (typeof path === "string" && path.length > 0) map.set(path, null)
  }
  return map
}

/**
 * Entry-wise equality for two changes maps — an unchanged republish (e.g.
 * the bus replaying its last value across a reconnect) must not churn the
 * signal and re-render every sidebar row. Exported for unit tests.
 */
export function sameWorktreeChangesMap(a: WorktreeChangesMap, b: WorktreeChangesMap): boolean {
  if (a.size !== b.size) return false
  for (const [path, counts] of a) {
    if (!b.has(path)) return false
    if (!sameWorktreeChanges(counts, b.get(path) ?? null)) return false
  }
  return true
}
