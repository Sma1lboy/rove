/**
 * Edits to a tab's split panes, on any tab and any pane: the chords (`split-view.tsx`), the right-click
 * menus and the rail's pane rows all go through here. The tree belongs to the server (`tab.split`).
 */

import { legendCap } from "@sma1lboy/rove/src/tui/lib/help-groups.ts"
import type { SplitView, TabRow } from "rove-bridge/protocol"
import { TextDialog } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import { terminalText } from "./keymap-text.ts"
import type { AppModel } from "./model.ts"
import { tabLabel } from "./rail.ts"
import { isSplit, leafNames, leafSignature, leavesOf } from "./split-model.ts"
import { createStore } from "./store.ts"
import { termFor } from "./term-control.ts"
import { streamKey } from "./term-mount.ts"
import { type MenuItem, dialog, toast } from "./ui.ts"
import { prefixHint } from "./user-keys.ts"

/** Local focus per tab, tied to the pane set it was chosen in (the server's `activeLeafId` seeds a new one). */
export const activeLeaves = createStore<Readonly<Record<string, { readonly sig: string; readonly leaf: string }>>>({})

export function activeLeafOf(taskId: string, tab: TabRow, split: SplitView): string {
  const saved = activeLeaves.get()[`${taskId}::${tab.id}`]
  return saved && saved.sig === leafSignature(split) && leavesOf(split.root).some((l) => l.id === saved.leaf)
    ? saved.leaf
    : split.activeLeafId
}

export function setActiveLeaf(taskId: string, tabId: string, split: SplitView, leaf: string): void {
  activeLeaves.set({ ...activeLeaves.get(), [`${taskId}::${tabId}`]: { sig: leafSignature(split), leaf } })
}

/** Make `leaf` the tab's active pane and put the keyboard in it (once its terminal is mounted it takes focus by itself). */
export function focusLeaf(taskId: string, tab: TabRow, split: SplitView, leaf: string): void {
  setActiveLeaf(taskId, tab.id, split, leaf)
  termFor(streamKey(taskId, tab.id, leaf))?.focus()
}

export function selectedTab(model: AppModel): { taskId: string; tab: TabRow } | null {
  const { taskId, tabId } = model.selection.get()
  const tab = taskId ? model.tabs.get()[taskId]?.find((row) => row.id === tabId) : undefined
  return taskId && tab ? { taskId, tab } : null
}

interface SplitReply {
  readonly leaf: string
  readonly changed: boolean
  readonly split: SplitView | null
}

/** One server edit, then the new layout in hand: `after` runs with the reply once the tab list has caught up. */
export async function editSplit(
  model: AppModel,
  args: Record<string, unknown>,
  after?: (reply: SplitReply) => void,
): Promise<void> {
  try {
    const reply = await model.client.request<SplitReply>("tab.split", args)
    await model.refreshTabsNow()
    after?.(reply)
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "error")
  }
}

/** Split `leaf` (default: the tab's active pane); the new pane takes focus. */
export function splitLeaf(
  model: AppModel,
  taskId: string,
  tab: TabRow,
  direction: "right" | "down",
  leaf?: string,
): void {
  const from = leaf ?? (tab.split ? activeLeafOf(taskId, tab, tab.split) : "leaf-1")
  // A tab menu may split a tab that is not on screen: bring it up so the new pane shows.
  const shown = model.selection.get()
  if (shown.taskId !== taskId || shown.tabId !== tab.id) model.select(taskId, tab.id)
  const size = termFor(streamKey(taskId, tab.id, from))?.size()
  void editSplit(model, { taskId, tabId: tab.id, action: "open", direction, leafId: from, ...size }, (reply) => {
    if (!reply.changed) toast(t("layout.splitTooSmall"), "error")
    else if (reply.split) setActiveLeaf(taskId, tab.id, reply.split, reply.leaf)
  })
}

/** Close one pane; the focus stays where it was unless that was the pane that went. */
export function closeLeaf(model: AppModel, taskId: string, tab: TabRow, leaf: string): void {
  const before = tab.split ? activeLeafOf(taskId, tab, tab.split) : leaf
  void editSplit(model, { taskId, tabId: tab.id, action: "close", leafId: leaf }, (reply) => {
    const split = reply.split
    if (!split) return
    const keep = before !== leaf && leavesOf(split.root).some((l) => l.id === before)
    setActiveLeaf(taskId, tab.id, split, keep ? before : split.activeLeafId)
  })
}

export function renameLeaf(model: AppModel, taskId: string, tab: TabRow, leaf: string): void {
  const split = tab.split
  if (!split) return
  dialog.set(
    <TextDialog
      title={terminalText("split.renameTitle")}
      initial={leafNames(split, tabLabel(tab)).get(leaf) ?? ""}
      allowEmpty
      submitLabel={t("dialog.save")}
      onSubmit={(title) => editSplit(model, { taskId, tabId: tab.id, action: "rename", leafId: leaf, title })}
    />,
  )
}

/** Rename and close for one pane, once the tab is split. */
export function paneEdits(model: AppModel, taskId: string, tab: TabRow, leaf: string): MenuItem[] {
  return [
    {
      label: t("menu.renamePane"),
      section: "split",
      key: legendCap("workspace.split.rename") ?? undefined,
      run: () => renameLeaf(model, taskId, tab, leaf),
    },
    {
      label: t("menu.closePane"),
      section: "split",
      // Ctrl+W is the browser's; the prefix route is the one that works here.
      key: prefixHint("workspace.split.close") || undefined,
      run: () => closeLeaf(model, taskId, tab, leaf),
    },
  ]
}

/** The pane menu: split it, and once split rename or close it. `leaf` defaults to the tab's active pane. */
export function splitMenu(model: AppModel, taskId: string, tab: TabRow, leaf?: string): MenuItem[] {
  const split = tab.split
  const target = leaf ?? (split ? activeLeafOf(taskId, tab, split) : "leaf-1")
  return [
    {
      label: t("menu.splitRight"),
      section: "split",
      key: legendCap("workspace.split.right") ?? undefined,
      run: () => splitLeaf(model, taskId, tab, "right", target),
    },
    {
      label: t("menu.splitDown"),
      section: "split",
      key: legendCap("workspace.split.down") ?? undefined,
      run: () => splitLeaf(model, taskId, tab, "down", target),
    },
    ...(isSplit(split) ? paneEdits(model, taskId, tab, target) : []),
  ]
}
