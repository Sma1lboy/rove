/**
 * Durable "seen this completion" record, the persisted half of the unread
 * lamp: the daemon's activity registry outlives the TUI, so a process-local
 * Set would re-light every read completion on relaunch.
 *
 * The mark is the completion's own `at`: `turn_complete` is STICKY, stamped
 * once per event, so "seen up to `at`" per (task, tab) can't swallow a newer turn.
 */

export const COMPLETION_SEEN_KEY = "completionSeen"

/** Oldest marks prune; at worst one long-untouched lamp re-lights. */
const SEEN_LIMIT = 200

export type CompletionSeenKv = {
  get(key: string, defaultValue?: unknown): unknown
  set(key: string, value: unknown): void
}

/** A task's rollup or one tab; NUL-joined like the session Set. */
export function completionSeenKey(taskId: string, tabId?: string): string {
  return tabId === undefined ? taskId : `${taskId}\0${tabId}`
}

/** Persisted marks are user-editable JSON — drop anything malformed. */
export function parseCompletionSeen(stored: unknown): Record<string, number> {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return {}
  const out: Record<string, number> = {}
  for (const [key, at] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof at === "number" && Number.isFinite(at)) out[key] = at
  }
  return out
}

/** Fold one completion in, pruning at the cap. Returns the INPUT object when
 *  already covered, so the per-render caller can skip the write. */
export function foldCompletionSeen(
  seen: Readonly<Record<string, number>>,
  key: string,
  at: number,
  limit = SEEN_LIMIT,
): Readonly<Record<string, number>> {
  const known = seen[key]
  if (known !== undefined && known >= at) return seen
  const next: Record<string, number> = { ...seen, [key]: at }
  const keys = Object.keys(next)
  if (keys.length <= limit) return next
  const pruned: Record<string, number> = {}
  for (const k of keys.sort((a, b) => next[b] - next[a]).slice(0, limit)) pruned[k] = next[k]
  return pruned
}

/** Has this row's CURRENT completion been seen? `at` undefined = no completion = never seen. */
export function completionSeenAt(kv: CompletionSeenKv | null, key: string, at: number | undefined): boolean {
  if (!kv || at === undefined) return false
  // Raw read, no full parse: once per row per frame.
  const stored = kv.get(COMPLETION_SEEN_KEY)
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return false
  const known = (stored as Record<string, unknown>)[key]
  return typeof known === "number" && known >= at
}

/** Record that the user has seen this completion. No-op when already covered. */
export function markCompletionSeen(kv: CompletionSeenKv, key: string, at: number): void {
  const seen = parseCompletionSeen(kv.get(COMPLETION_SEEN_KEY))
  const next = foldCompletionSeen(seen, key, at)
  if (next !== seen) kv.set(COMPLETION_SEEN_KEY, next)
}

/**
 * The `stamps` the persisted record covers: the tab strip reads the SAME
 * record as the sidebar lamp so both agree across restarts. No stamp (the
 * poll-only path) is never "seen".
 */
export function seenCompletionTabs(
  kv: CompletionSeenKv | null,
  taskId: string,
  stamps: Iterable<readonly [string, number | undefined]>,
): ReadonlySet<string> {
  const seen = new Set<string>()
  for (const [tabId, at] of stamps) {
    if (completionSeenAt(kv, completionSeenKey(taskId, tabId), at)) seen.add(tabId)
  }
  return seen
}
