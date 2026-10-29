/**
 * The workspace tab strip's right-click menu per tab. Same rule as the
 * sidebar's (`tree-menu.ts`): an entry routes to what the tab's keyboard
 * already does, and `closeOthers` / `copyAddress` are menu-only until the
 * owner agrees a chord. Labels are i18n KEYS.
 */

import type { TerminalTab } from "./terminal-tab-shapes"

export type TabStripMenuAction = "rename" | "copyAddress" | "closeOthers" | "close"

export interface TabStripMenuItem {
  readonly action: TabStripMenuAction
  /** i18n key under `terminal.tab.menu.*`. */
  readonly labelKey: string
  readonly danger?: boolean
  /** Keymap row this entry mirrors, for its live chord cap. */
  readonly bindingId?: string
}

export function tabStripMenuItems(tab: TerminalTab, tabCount: number): TabStripMenuItem[] {
  const items: TabStripMenuItem[] = [
    { action: "rename", labelKey: "terminal.tab.menu.rename", bindingId: "chat.tab.rename" },
  ]
  // A preview/diff tab runs no process, so `rove api send --tab` has nothing to reach.
  if (tab.kind !== "content") items.push({ action: "copyAddress", labelKey: "terminal.tab.menu.copyAddress" })
  // Ends every sibling's session: danger-toned, and the host confirms first.
  if (tabCount > 1) items.push({ action: "closeOthers", labelKey: "terminal.tab.menu.closeOthers", danger: true })
  items.push({ action: "close", labelKey: "terminal.tab.menu.close", bindingId: "chat.tab.close" })
  return items
}
