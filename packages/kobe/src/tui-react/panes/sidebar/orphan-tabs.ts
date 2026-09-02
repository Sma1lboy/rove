/**
 * Backstop for tab rows the KV snapshot doesn't know about.
 *
 * The tree's primary source is the task's persisted tab snapshot, written by
 * a mounting `TerminalTabs` and (since the CLI fix) by the headless launch
 * path. But a snapshot is a RECORD of intent, while the pty host holds the
 * truth about what is actually running — and the two can disagree:
 *
 *   - a session started by an older kobe, before the CLI wrote snapshots;
 *   - a snapshot reclaimed by the orphan sweep while its PTY lived on;
 *   - anything that opens a `<taskId>::<tabId>` session without going
 *     through either writer (a canonical-spawn fallback can run a live engine
 *     for hours that the sidebar never shows).
 *
 * In every one of those the engine is alive and the sidebar showed either
 * nothing or a tab list missing the session. So: reconcile at TAB
 * granularity — any live session whose exact `<taskId>::<tabId>` key the
 * snapshots don't answer for becomes an explicit "unregistered" row (⚠).
 * A registered tab keeps its snapshot projection, which carries titles,
 * ordinals, kinds and split state a session key can't.
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
}

/**
 * Group live sessions into UNREGISTERED tab rows per task, skipping every
 * exact `<taskId>::<tabId>` key in `registered` (a snapshot answered for
 * those tabs). Tab-granular on purpose: a task whose snapshot lists tab-2
 * while tab-1 is alive must still surface tab-1 — that divergence is an
 * invisible live engine, and skipping whole tasks is what hides it.
 *
 * The label is the live process title when the host has one, else the tab
 * id, prefixed ⚠ — the row exists because the snapshot does NOT know this
 * session, and that is worth a glance. The title is a RAW OSC string here
 * (nobody has stripped it — that happens on the mounted-tab path), so the
 * engine's own status decoration comes off first: kobe draws the state glyph
 * on this row, and two status languages side by side is what
 * `stripEngineStatusPrefix` exists to prevent. Vendor-agnostic strip — an
 * unregistered session has no resolved vendor by construction.
 */
export function orphanTabsByTask(
  sessions: readonly LiveSession[],
  registered: ReadonlySet<string>,
): Map<string, readonly TreeTab[]> {
  const byTask = new Map<string, TreeTab[]>()
  for (const session of sessions) {
    if (session.alive === false) continue
    // A pty key IS a tab row id (`<taskId>::<tabId>`) — same separator, same
    // parse rule, so the two can never disagree about what a key means.
    const { taskId, tabId: rawTabId } = parseRowId(session.key)
    if (!rawTabId) continue
    // A split's extra shell leaf (`<tabId>::leaf-N`) belongs to its tab.
    const tabId = rawTabId.split("::")[0] as string
    if (registered.has(tabRowId(taskId, tabId))) continue
    const tabs = byTask.get(taskId) ?? []
    if (tabs.some((tab) => tab.id === tabId)) continue
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

/**
 * Keep only orphan tabs whose task is still in the task list — membership
 * via ONE Set build, not a per-orphan `tasks.some` scan. This runs inside
 * the tree's orphan memo; with a few hundred tasks, every orphan row used
 * to re-scan the whole array to prove its task exists.
 */
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
