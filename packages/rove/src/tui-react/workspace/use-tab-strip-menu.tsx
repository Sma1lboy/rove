/** @jsxImportSource @opentui/react */
/**
 * The tab strip's right-click menu. What it OFFERS is `tab-strip-menu.ts`;
 * rename and close are the tab's own F2 / ctrl+w paths, run on the clicked
 * tab while it remains selected and present.
 */

import type { BoxRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { type ReactNode, useRef, useState } from "react"
import { formatChord } from "../../tui/lib/chord-glyphs"
import { copyTextToSystemClipboard } from "../../tui/lib/clipboard-copy"
import { legendCap } from "../../tui/lib/help-groups"
import { tabAddress } from "../../tui/lib/task-actions"
import { type TabStripMenuAction, type TabStripMenuItem, tabStripMenuItems } from "../../tui/workspace/tab-strip-menu"
import type { TerminalTab } from "../../tui/workspace/terminal-tabs-core"
import { useKV } from "../context/kv"
import { useNotifications } from "../context/notifications"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { useGlobalMouseDown } from "../lib/use-global-mouse-down"
import { ContextMenu } from "../ui/context-menu"
import { useDialog } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"
import { closeOtherTaskTabs } from "./terminal-tabs-close"

export interface TabStripMenuDeps {
  readonly taskId: string
  readonly tabs: readonly TerminalTab[]
  readonly activeId: string
  /** Make the clicked tab active, so highlight and menu agree. */
  readonly select: (tabId: string) => void
  readonly rename: () => void
  readonly closeActive: () => void
}

interface OpenMenu {
  readonly tabId: string
  readonly items: readonly TabStripMenuItem[]
  readonly x: number
  readonly y: number
}

export interface TabStripMenu {
  /** Ref for the box the menu is drawn in; click coordinates are made relative to it. */
  readonly anchorRef: (box: BoxRenderable | null) => void
  readonly openForTab: (tabId: string, x: number, y: number) => void
  readonly overlay: ReactNode
}

export function useTabStripMenu(deps: TabStripMenuDeps): TabStripMenu {
  const t = useT()
  const kv = useKV()
  const notif = useNotifications()
  const dialog = useDialog()
  const renderer = useRenderer()
  const anchor = useRef<BoxRenderable | null>(null)
  const [openMenu, setMenu] = useState<OpenMenu | null>(null)
  const menu = openMenu?.tabId === deps.activeId && deps.tabs.some((tab) => tab.id === openMenu.tabId) ? openMenu : null
  // Clear during render so neither mouse nor key dispatch can use a stale target.
  if (openMenu && !menu) setMenu(null)
  const [cursor, setCursor] = useState(0)
  const close = (): void => setMenu(null)

  const openForTab = (tabId: string, x: number, y: number): void => {
    const tab = deps.tabs.find((candidate) => candidate.id === tabId)
    if (!tab) return
    deps.select(tabId)
    const box = anchor.current
    // An absolute child is placed relative to its parent; mouse events report screen cells.
    setMenu({ tabId, items: tabStripMenuItems(tab, deps.tabs.length), x: x - (box?.x ?? 0), y: y - (box?.y ?? 0) })
    setCursor(0)
  }

  // A press elsewhere dismisses; presses inside are swallowed by `ContextMenu`.
  useGlobalMouseDown(menu !== null, close)

  const closeOthers = async (tabId: string): Promise<void> => {
    const count = deps.tabs.length - 1
    if (count < 1) return
    // Ends sessions the user isn't looking at, so it asks first.
    const ok = await DialogConfirm.show(
      dialog,
      t("terminal.tab.closeOthersTitle"),
      t("terminal.tab.closeOthersBody", { count: String(count) }),
      t("terminal.tab.closeOthersCancel"),
      t("terminal.tab.closeOthersConfirm"),
      { danger: true },
    )
    if (ok !== true) return
    if (closeOtherTaskTabs(kv, deps.taskId, tabId) === 0)
      notif.notify({ kind: "error", taskId: deps.taskId, tabId, title: t("terminal.tab.tabGone") })
  }

  const copyAddress = async (tabId: string): Promise<void> => {
    const text = tabAddress(deps.taskId, tabId)
    const copied = await copyTextToSystemClipboard(text, (payload) => renderer?.copyToClipboardOSC52(payload))
    notif.notify({
      kind: copied ? "done" : "error",
      taskId: deps.taskId,
      tabId,
      title: copied ? t("tasks.toast.copiedTab", { text }) : t("tasks.toast.copyFailed"),
    })
  }

  const fire = (action: TabStripMenuAction | undefined): void => {
    if (!menu || action === undefined) return
    // Close BEFORE dispatching: rename and close-others open a dialog.
    const tabId = menu.tabId
    setMenu(null)
    if (action === "rename") deps.rename()
    else if (action === "close") deps.closeActive()
    else if (action === "closeOthers") void closeOthers(tabId)
    else void copyAddress(tabId)
  }

  // Wraps, like the sidebar's menu.
  const move = (delta: 1 | -1): void => {
    const count = menu?.items.length ?? 0
    if (count > 0) setCursor((prev) => (prev + delta + count) % count)
  }

  // Ancestor of the terminal, so these sit above it and the engine never sees them while open.
  useBindings(() => ({
    enabled: menu !== null,
    bindings: [
      { key: "up", cmd: () => move(-1) },
      { key: "k", cmd: () => move(-1) },
      { key: "down", cmd: () => move(1) },
      { key: "j", cmd: () => move(1) },
      { key: "return", cmd: () => fire(menu?.items[cursor]?.action) },
      { key: "escape", cmd: close },
    ],
  }))

  const overlay = menu ? (
    <ContextMenu
      entries={menu.items.map((item) => {
        const cap = item.bindingId ? legendCap(item.bindingId) : undefined
        return {
          id: item.action,
          label: t(item.labelKey),
          danger: item.danger,
          cap: cap ? formatChord(cap) : undefined,
        }
      })}
      cursor={cursor}
      x={menu.x}
      y={menu.y}
      // Clamp to the workspace: the menu is a child of it.
      dims={{ width: anchor.current?.width ?? 0, height: anchor.current?.height ?? 0 }}
      onPick={(id) => fire(menu.items.find((item) => item.action === id)?.action)}
    />
  ) : null

  return {
    anchorRef: (box) => {
      anchor.current = box
    },
    openForTab,
    overlay,
  }
}
