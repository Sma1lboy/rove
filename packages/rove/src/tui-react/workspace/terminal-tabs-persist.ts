/**
 * The `terminalTabs.<taskId>` keys of state.json. The daemon's tab store is
 * their only writer (`state/tabs-persistence.ts`); a TUI reads one only to
 * paint a task before the daemon's tabs arrive.
 */

export { terminalTabsKey } from "../../state/tabs-persistence.ts"

/** Satisfied by `KVContext`. */
export interface TabsSnapshotKv {
  readonly store: Record<string, unknown>
  set(key: string, value: unknown): void
}
