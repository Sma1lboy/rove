/**
 * Backstop for tab rows the KV snapshot doesn't know about. A snapshot
 * (written by a mounting `TerminalTabs` and the headless launch path) is a
 * RECORD of intent; the pty host holds the truth. They diverge when the
 * orphan sweep reclaims a snapshot whose PTY lived on, or a session opens
 * without either writer (a canonical-spawn fallback).
 *
 * Reconciled at TAB granularity: a live session whose exact
 * `<taskId>::<tabId>` no snapshot answers for becomes a "⚠" row. Registered
 * tabs keep their snapshot projection (titles, ordinals, kinds, splits).
 */

import type { Task } from "@/types/task"
import { stripEngineStatusPrefix } from "../../../engine/registry"
import { type TreeTab, parseRowId, tabRowId } from "../../../tui/panes/sidebar/tree-core"

/** One live pty-host session, as this module needs it. */
export interface LiveSession {
  readonly key: string
  readonly alive?: boolean
  /** OSC window title of the live process, when the host observed one. */
  readonly title?: string | null
  /** Shell pid of the hosted session — roots the live-engine probe's
   *  process-tree walk for tabs this TUI never attached. */
  readonly pid?: number | null
  /** A freeze-restored corpse awaiting respawn-on-open: scrollback kept,
   *  process gone. Absent on older hosts. */
  readonly restored?: boolean
}

/**
 * Live sessions → UNREGISTERED tab rows per task, skipping keys in
 * `registered`. Tab-granular: a snapshot listing tab-2 while tab-1 is alive
 * must still surface tab-1.
 *
 * Label: ⚠ + the live title, else the tab id. The title is RAW OSC here, so
 * the engine's status decoration is stripped (vendor-agnostic: an
 * unregistered session has no resolved vendor) since kobe draws its own glyph.
 */
export function orphanTabsByTask(
  sessions: readonly LiveSession[],
  registered: ReadonlySet<string>,
): Map<string, readonly TreeTab[]> {
  const byTask = new Map<string, TreeTab[]>()
  const known = new Set(registered)
  for (const session of sessions) {
    if (session.alive === false) continue
    // A pty key IS a tab row id, so one parse rule serves both.
    const { taskId, tabId: rawTabId } = parseRowId(session.key)
    if (!rawTabId) continue
    // A split's extra shell leaf (`<tabId>::leaf-N`) belongs to its tab.
    const tabId = rawTabId.split("::")[0] as string
    const rowId = tabRowId(taskId, tabId)
    if (known.has(rowId)) continue
    known.add(rowId)
    const tabs = byTask.get(taskId) ?? []
    tabs.push({
      id: tabId,
      label: `⚠ ${stripEngineStatusPrefix(session.title?.trim() ?? "", null).trim() || tabId}`,
      // The first unregistered tab of a snapshot-less task reads active; the
      // caller demotes this when merging under a task that has snapshot tabs.
      active: tabs.length === 0,
      // Assume engine: the headless launch path only ever starts engines,
      // and the state glyph is the reason these rows are worth showing.
      engine: true,
    })
    byTask.set(taskId, tabs)
  }
  return byTask
}

/** Keep orphan tabs whose task still exists; one Set, not a per-orphan scan (runs in the tree's memo). */
export function filterKnownOrphanTabs(
  tasks: readonly Task[],
  orphans: ReadonlyMap<string, readonly TreeTab[]>,
): ReadonlyMap<string, readonly TreeTab[]> {
  const taskIds = new Set<string>(tasks.map((task) => task.id))
  const known = new Map<string, readonly TreeTab[]>()
  for (const [taskId, tabs] of orphans) {
    if (taskIds.has(taskId)) known.set(taskId, tabs)
  }
  return known
}
