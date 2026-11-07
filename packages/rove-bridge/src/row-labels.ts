/**
 * What a task row is called, computed once here so every client shows the same name: the TUI's
 * rule (`worktreeRowLabel`) over the engine's own conversation title (`conversationTitle`) read
 * from the live PTY host, falling back to the recorded one.
 */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { conversationTitleOf, worktreeRowLabel } from "@sma1lboy/rove/src/tui/panes/sidebar/tree-labels.ts"
import { conversationTitle } from "@sma1lboy/rove/src/tui/workspace/terminal-tab-split.ts"
import { type TabsState, tabPtyKeyFor } from "@sma1lboy/rove/src/tui/workspace/terminal-tabs-core.ts"
import { DEFAULT_TASK_VENDOR, type Task } from "@sma1lboy/rove/src/types/task.ts"

/** The live inputs of the row names, read once per feed read. */
export interface RowTitleSources {
  /** PTY session key (`<taskId>::<tabId>`) → the title its process set (OSC 0/2); sessions with none are absent. */
  readonly sessions: ReadonlyMap<string, string>
  /** A task's persisted tab layout, when it has one. */
  tabs(taskId: string): TabsState | undefined
}

/**
 * taskId → row name. A task with no engine tab named yet reads its stored title / branch / path,
 * as does a task of another machine (its PTY host is not this one's). Main and dir rows have no
 * live HEAD here, so they read the stored branch the daemon recorded.
 */
export function rowLabels(
  tasks: readonly SerializedTask[],
  sources: RowTitleSources | null,
): ReadonlyMap<string, string> {
  const tabsByTask = new Map<string, { id: string; title?: string; engine: boolean }[]>()
  for (const task of tasks) {
    const snapshot = sources?.tabs(task.id)
    if (!snapshot) continue
    const vendor = task.vendor ?? DEFAULT_TASK_VENDOR
    tabsByTask.set(
      task.id,
      snapshot.tabs.map((tab) => {
        const title = conversationTitle(tab, vendor, sources?.sessions.get(tabPtyKeyFor(task.id, tab)))
        return { id: tab.id, ...(title ? { title } : {}), engine: tab.kind === "engine" }
      }),
    )
  }
  return new Map(
    tasks.map((task) => {
      const liveTitle = conversationTitleOf(task as unknown as Task, tabsByTask)
      return [task.id, worktreeRowLabel(task as unknown as Task, liveTitle ? { liveTitle } : {})]
    }),
  )
}
