/**
 * An engine's own name for its conversation (its OSC title) is a title report like any other: the
 * newest report wins, whoever made it — the first prompt, the engine, `update --title`, a rename.
 * The task remembers the last engine report it applied (`engineTitle`), so seeing the same title
 * again (every observer tick, every daemon restart) never undoes a rename made after it.
 */

import type { DaemonOrchestrator, VendorId } from "./contracts.ts"
import type { SharedTabs, TabRow } from "./tabs-ops.ts"

export interface EngineTitleSyncDeps {
  readonly orch: Pick<DaemonOrchestrator, "getTask" | "setTitle">
  readonly tabsOf: (taskId: string) => SharedTabs | null
  /** rove's `conversationTitle`: the engine's name for the tab, or null for a placeholder / product name. */
  readonly conversationTitle: (tab: TabRow, vendor: VendorId, rawTitle: string) => string | null
  readonly defaultVendor: VendorId
}

/** Apply `rawTitle` (the OSC title of `taskId`'s `tabId`) when it names the task's conversation and is new. */
export async function syncEngineTitle(
  deps: EngineTitleSyncDeps,
  taskId: string,
  tabId: string,
  rawTitle: string,
): Promise<void> {
  if (!rawTitle.trim()) return
  const task = deps.orch.getTask(taskId)
  if (!task) return
  // The task's conversation: a migrated child's aliased tab, else the first engine tab.
  const alias = task.ptyAlias
  const tabs = deps.tabsOf(alias?.taskId ?? taskId)?.tabs ?? []
  const tab = alias ? tabs.find((t) => t.id === alias.tabId) : tabs.find((t) => t.kind === "engine")
  if (!tab || tab.id !== tabId) return
  const named = deps.conversationTitle(tab, task.vendor ?? deps.defaultVendor, rawTitle)?.trim()
  if (!named || named === task.engineTitle) return
  await deps.orch.setTitle(taskId, named, { fromEngine: true })
}
