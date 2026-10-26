/**
 * One group's row of tabs along the panel's top: icon and short name, a × on hover, middle-click to
 * close, right-click for the move / close menu, drag to reorder or move to the other group, and a
 * quiet + that opens a new tab. On a phone the row only lists the tabs of the chosen kind.
 */

import { type DragEvent, type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react"
import { t, useLocale } from "./i18n/index.ts"
import type { PanelKind } from "./panel-layout.ts"
import {
  type GroupName,
  type PanelItem,
  type TaskPanel,
  activate,
  browserHost,
  browserUrl,
  closeOthers,
  diffName,
  moveTab,
  newBrowser,
  newFiles,
  showDiff,
} from "./panel-model.ts"
import { closePanelTab, editPanel } from "./panel-state.ts"
import { openMenu } from "./rail-view.tsx"
import { type MenuItem, menu } from "./ui.ts"

export function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="panel-icon" viewBox="0 0 16 16" aria-hidden="true">
      {children}
    </svg>
  )
}

export const ICONS: Record<PanelKind, ReactNode> = {
  files: <path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />,
  diff: <path d="M8 3v6M5 6h6M5 12.5h6" />,
  browser: <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM2 8h12M8 2c2.2 2 2.2 10 0 12M8 2c-2.2 2-2.2 10 0 12" />,
}

function label(tab: PanelItem): string {
  if (tab.kind === "files") return t("panel.files")
  if (tab.kind === "diff") return tab.path === "." ? t("panel.diff") : diffName(tab.path)
  const url = browserUrl(tab)
  return url ? browserHost(url) : t("panel.browser")
}

function tooltip(tab: PanelItem): string {
  if (tab.kind === "diff") return tab.path === "." ? t("preview.whole") : tab.path
  return tab.kind === "browser" ? browserUrl(tab) || label(tab) : label(tab)
}

/** The row's font is 12px mono: one column per ASCII character, two for wide ones (CJK). */
const COLUMN_PX = 7.3
/** Padding, icon, gap and the × slot around a tab's label; and the cap from `.ptab`'s max-width. */
const TAB_CHROME_PX = 51
const TAB_MAX_PX = 160

/** Whether every tab fits at its full label; past that, the row goes compact (only the shown tab keeps its name). */
export function tabsFit(labels: readonly string[], width: number): boolean {
  let total = 0
  for (const text of labels) {
    let columns = 0
    for (const ch of text) columns += (ch.codePointAt(0) ?? 0) > 0x2e7f ? 2 : 1
    total += Math.min(TAB_MAX_PX, TAB_CHROME_PX + columns * COLUMN_PX) + 2
  }
  return total <= width
}

/** The tab being dragged; a drag carries nothing the page can read while it is over a target. */
let dragging: { taskId: string; id: string } | null = null

function tabMenu(taskId: string, panel: TaskPanel, tab: PanelItem, group: GroupName): MenuItem[] {
  const move = (to: GroupName, label: string): MenuItem => ({
    label,
    section: "move",
    run: () => editPanel(taskId, (p) => moveTab(p, tab.id, to)),
  })
  const items: MenuItem[] = []
  if (!panel.bottom && panel.top.tabs.length > 1) items.push(move("bottom", t("panel.splitDown")))
  else if (panel.bottom)
    items.push(group === "top" ? move("bottom", t("panel.moveBottom")) : move("top", t("panel.moveTop")))
  items.push({ label: t("panel.close"), section: "close", run: () => closePanelTab(taskId, tab.id) })
  if (panel.top.tabs.length + (panel.bottom?.tabs.length ?? 0) > 1) {
    items.push({
      label: t("panel.closeOthers"),
      section: "close",
      run: () => editPanel(taskId, (p) => closeOthers(p, tab.id)),
    })
  }
  return items
}

function newMenu(taskId: string, group: GroupName): MenuItem[] {
  return [
    { label: t("panel.newFiles"), run: () => editPanel(taskId, (p) => newFiles(p, group)) },
    { label: t("panel.newDiff"), run: () => editPanel(taskId, (p) => showDiff(p, ".", "working")) },
    { label: t("panel.newBrowser"), run: () => editPanel(taskId, (p) => newBrowser(p, group)) },
  ]
}

export function PanelTabRow({
  taskId,
  panel,
  group,
  tabs,
  active,
  narrow,
}: {
  taskId: string
  panel: TaskPanel
  group: GroupName
  tabs: readonly PanelItem[]
  active: string | null
  narrow: boolean
}) {
  useLocale()
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null)
  const mine = () => dragging?.taskId === taskId
  const drop = (index?: number) => {
    const from = dragging
    dragging = null
    setOver(null)
    if (from?.taskId === taskId) editPanel(taskId, (p) => moveTab(p, from.id, group, index))
  }
  const openNew = (e: MouseEvent<HTMLButtonElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    menu.set({ x: box.left, y: box.bottom + 2, items: newMenu(taskId, group), target: e.currentTarget })
  }
  const dragOver = (e: DragEvent<HTMLElement>, id: string) => {
    if (!mine()) return
    e.preventDefault()
    e.stopPropagation()
    const box = e.currentTarget.getBoundingClientRect()
    setOver({ id, after: e.clientX > box.left + box.width / 2 })
  }

  const strip = useRef<HTMLDivElement>(null)
  // The row fills the head, so its width is the room the panel gives it, whatever the tabs take.
  const [room, setRoom] = useState(0)
  useEffect(() => {
    const el = strip.current
    if (!el) return
    const watch = new ResizeObserver(([entry]) => setRoom(entry?.contentRect.width ?? 0))
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  const compact = room > 0 && !tabsFit(tabs.map(label), room)
  // The shown tab stays in view when the row scrolls.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `active`, the tab count and compaction are what move the shown tab
  useEffect(() => {
    strip.current?.querySelector(".is-active")?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [active, tabs.length, compact])

  return (
    <div
      className="side-head"
      style={{ gridRow: group === "top" ? 1 : 4 }}
      onDragOver={(e) => {
        if (!mine()) return
        e.preventDefault()
        setOver(null)
      }}
      onDrop={(e) => {
        e.preventDefault()
        drop()
      }}
    >
      <div className={`ptabs ${compact ? "is-compact" : ""}`} role="tablist" aria-label={t("panel.tabs")} ref={strip}>
        {tabs.map((tab, i) => (
          <div
            key={tab.id}
            role="presentation"
            className={`ptab ${tab.id === active ? "is-active" : ""}`}
            data-drop={over?.id === tab.id ? (over.after ? "after" : "before") : undefined}
            draggable={!narrow}
            onDragStart={() => {
              dragging = { taskId, id: tab.id }
            }}
            onDragEnd={() => {
              dragging = null
              setOver(null)
            }}
            onDragOver={(e) => dragOver(e, tab.id)}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              drop(i + (over?.id === tab.id && over.after ? 1 : 0))
            }}
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault()
            }}
            onAuxClick={(e) => {
              if (e.button !== 1) return
              e.preventDefault()
              closePanelTab(taskId, tab.id)
            }}
            onContextMenu={(e) => {
              if (!narrow) openMenu(e, tabMenu(taskId, panel, tab, group))
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === active}
              className="ptab-main"
              title={tooltip(tab)}
              onClick={() => editPanel(taskId, (p) => activate(p, tab.id))}
            >
              <Icon>{ICONS[tab.kind]}</Icon>
              <span className="ptab-label">{label(tab)}</span>
            </button>
            <button
              type="button"
              className="ptab-close"
              aria-label={t("panel.close")}
              tabIndex={-1}
              onClick={() => closePanelTab(taskId, tab.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {!narrow && (
        <button
          type="button"
          className="rail-bar-btn panel-new"
          title={t("panel.new")}
          aria-label={t("panel.new")}
          onClick={openNew}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 3.5v9M3.5 8h9" />
          </svg>
        </button>
      )}
    </div>
  )
}
