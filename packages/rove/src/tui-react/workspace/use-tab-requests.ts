/**
 * Consumes the cross-component tab REQUESTS (`terminal-tabs-shared.ts`) aimed
 * at this task: activation (F7), plugin-pane open/close, tree-menu new-tab and
 * close, adoption, move, rename. Consuming is what CLAIMS a request; one still
 * pending after the listener sweep is ownerless, and only then may a
 * background writer touch the state (`closeTaskTab` / `adoptTaskTabs`). One
 * place does it so that rule stays true. Mount-only; reads via the caller's
 * latest-render refs (see TerminalTabs' header).
 */

import { useEffect } from "react"
import { defaultShell } from "../../tui/panes/terminal/pty-types"
import { getDefaultPtyRegistry } from "../../tui/panes/terminal/registry"
import { closePluginPanes, openPluginPane } from "../../tui/workspace/pane-split"
import { adoptTabs } from "../../tui/workspace/tabs-adopt"
import {
  type TabsState,
  moveTab,
  openCommandTab,
  selectTab,
  setTabTitle,
  splitLeafPtyKey,
  tabPtyKeyFor,
} from "../../tui/workspace/terminal-tabs-core"
import {
  tabActivationListeners,
  takeNewTab,
  takePaneClose,
  takeTabActivation,
  takeTabAdopt,
  takeTabClose,
  takeTabMove,
  takeTabOpen,
  takeTabRename,
} from "./terminal-tabs-shared"

export interface TabRequestIO {
  readonly stateRef: { readonly current: TabsState }
  readonly propsRef: { readonly current: { readonly taskId: string } }
  /** The caller's single state writer. */
  readonly updateRef: { readonly current: (next: TabsState) => void }
  readonly tabCloseRef: { readonly current: { closeById: (id: string) => void } }
  /** Active leaf geometry for the split-size gate; null when no PTY yet. */
  readonly activeLeafSizeRef: { readonly current: () => { cols: number; rows: number } | null }
  /** The ctrl+e picker opener (`useTabDialogs`): what the tree's "New conversation" presses. */
  readonly requestNewChatRef: { readonly current: () => void }
}

export function useTabRequests(io: TabRequestIO): void {
  const { stateRef, propsRef, updateRef, tabCloseRef, activeLeafSizeRef, requestNewChatRef } = io
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once by design — every read goes through a latest-render ref.
  useEffect(() => {
    const consume = (): void => {
      const taskId = propsRef.current.taskId
      const tabId = takeTabActivation(taskId)
      if (tabId) {
        const s = stateRef.current
        if (s.activeId !== tabId && s.tabs.some((tab) => tab.id === tabId)) updateRef.current(selectTab(s, tabId))
      }
      // Plugin panes: split the focused chattab (default) or open a command
      // tab (pane-split.ts owns the policy); an explicit tabId hosts the split there.
      const open = takeTabOpen(taskId)
      if (open) {
        const size = activeLeafSizeRef.current()
        updateRef.current(
          openPluginPane(stateRef.current, open.argv, open.title, open.placement, open.direction, size, open.tabId),
        )
      }
      // Prune matching titled leaves (state first, then release); whole
      // matching command tabs go through the normal close. tabId scopes the match.
      const paneClose = takePaneClose(taskId)
      if (paneClose) {
        const prev = stateRef.current
        const { next, closedLeaves, closedTabIds } = closePluginPanes(prev, paneClose.title, paneClose.tabId)
        if (next !== prev) updateRef.current(next)
        for (const { tabId: id, leafId } of closedLeaves) {
          const tab = prev.tabs.find((x) => x.id === id)
          if (tab) getDefaultPtyRegistry().release(splitLeafPtyKey(tabPtyKeyFor(taskId, tab), leafId))
        }
        for (const id of closedTabIds) tabCloseRef.current.closeById(id)
      }
      // "New conversation" = the ctrl+e picker; "New shell" = its shell pick
      // directly. The sidebar activated this task first, so a cold task's
      // request is claimed by its first mount.
      const newTab = takeNewTab(taskId)
      if (newTab === "chat") requestNewChatRef.current()
      else if (newTab === "shell") updateRef.current(openCommandTab(stateRef.current, [defaultShell()], null))
      // A live session this state doesn't list becomes a real tab.
      const adopt = takeTabAdopt(taskId)
      if (adopt) {
        const prev = stateRef.current
        const next = adoptTabs(prev, adopt)
        if (next !== prev) updateRef.current(next)
      }
      // Through the single writer so it persists; `moveTab` edge-stops, so a
      // top/bottom press is a same-object no-op.
      const move = takeTabMove(taskId)
      if (move) {
        const prev = stateRef.current
        const next = moveTab(prev, move.tabId, move.delta)
        if (next !== prev) updateRef.current(next)
      }
      // `setTabTitle` is normally a same-object no-op (the CLI wrote the
      // snapshot before broadcasting); the writer still repaints and persists
      // when it isn't.
      const rename = takeTabRename(taskId)
      if (rename) {
        const prev = stateRef.current
        const next = setTabTitle(prev, rename.tabId, rename.title)
        if (next !== prev) updateRef.current(next)
      }
      // Claiming here keeps `closeTaskTab` from ALSO writing background state:
      // while mounted, this component owns it.
      const closeId = takeTabClose(taskId)
      if (closeId) tabCloseRef.current.closeById(closeId)
    }
    consume()
    tabActivationListeners.add(consume)
    return () => {
      tabActivationListeners.delete(consume)
    }
  }, [])
}
