/**
 * Reclaims the `terminalTabs.*` kv snapshots `TerminalTabs.tsx` writes on every
 * mutation. Without a deleter they only grow: one orphan per deleted task, and
 * since kv-core rewrites the whole file, every orphan taxes every later write.
 * `set(key, undefined)` deletes. Hook on task DELETE only: that is when the
 * snapshot is genuinely dead.
 */

const TERMINAL_TABS_PREFIX = "terminalTabs."

export function terminalTabsKey(taskId: string): string {
  return `${TERMINAL_TABS_PREFIX}${taskId}`
}

/** Satisfied by `KVContext`. */
export interface TabsSnapshotKv {
  readonly store: Record<string, unknown>
  set(key: string, value: unknown): void
}

export function forgetTaskTabsSnapshot(kv: TabsSnapshotKv, taskId: string): void {
  const key = terminalTabsKey(taskId)
  if (kv.store[key] === undefined) return
  kv.set(key, undefined)
}

/**
 * Drop every snapshot whose task id isn't in `liveTaskIds` (covers deletes
 * made elsewhere). Idempotent; returns the count swept.
 */
export function sweepOrphanTabsSnapshots(kv: TabsSnapshotKv, liveTaskIds: Iterable<string>): number {
  const live = new Set(liveTaskIds)
  let swept = 0
  for (const key of Object.keys(kv.store)) {
    if (!key.startsWith(TERMINAL_TABS_PREFIX)) continue
    const taskId = key.slice(TERMINAL_TABS_PREFIX.length)
    if (live.has(taskId)) continue
    kv.set(key, undefined)
    swept++
  }
  return swept
}
