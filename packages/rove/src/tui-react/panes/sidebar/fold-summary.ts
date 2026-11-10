/**
 * What a folded task says about the children it hides: the most urgent state
 * among them, ranked by the daemon's own task-row rule (attention → needs input
 * → running → unseen → idle), never a ranking of the TUI's.
 */

import {
  type RowStatus,
  type RowStatusKind,
  type RowStatusReason,
  type TabStatus,
  taskStatus,
} from "@sma1lboy/rove-daemon/daemon/row-status"
import { useMemo, useSyncExternalStore } from "react"
import { type RowStatusMap, rowStatusCell, taskRowStatus } from "../../workspace/row-status-sync"

const NO_SUBSCRIBE = (): (() => void) => () => {}

/** The most urgent rollup among `taskIds`, or undefined when none has a status yet. */
export function mostUrgentStatus(map: RowStatusMap, taskIds: readonly string[]): RowStatus | undefined {
  // `taskStatus` ranks a record of tab statuses; each child's rollup stands in for one.
  const children: Record<string, TabStatus> = {}
  for (const id of taskIds) {
    const status = taskRowStatus(map, id)
    if (status) children[id] = { ...status, alive: true, restored: false, tracked: true }
  }
  return Object.keys(children).length === 0 ? undefined : taskStatus(children)
}

/**
 * Re-renders only when the winning kind (or its reason) changes, not on every
 * status push: the snapshot is a string, since `taskStatus` builds a fresh object.
 * `enabled` false (an open fold) subscribes to nothing.
 */
export function useMostUrgentStatus(taskIds: readonly string[], enabled: boolean): RowStatus | undefined {
  const read = (): string => {
    const status = enabled ? mostUrgentStatus(rowStatusCell.get(), taskIds) : undefined
    return status ? `${status.kind}|${status.reason ?? ""}` : ""
  }
  const key = useSyncExternalStore(enabled ? rowStatusCell.subscribe : NO_SUBSCRIBE, read, read)
  return useMemo((): RowStatus | undefined => {
    if (key === "") return undefined
    const [kind, reason] = key.split("|")
    return { kind: kind as RowStatusKind, since: 0, ...(reason ? { reason: reason as RowStatusReason } : {}) }
  }, [key])
}
