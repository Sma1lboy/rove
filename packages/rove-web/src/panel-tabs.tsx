/**
 * The Browser column's tabs, the only tabs the side panel has: icon-less short names sitting tight as in
 * a browser's tab bar, a × on hover, middle-click to close, right-click for the close menu, and a quiet
 * + after the last one that opens a blank tab. Also the panel's kind icons, shared with the top bar.
 */

import { type ReactNode, useEffect, useRef, useState } from "react"
import {
  type BrowserColumn,
  type BrowserTab,
  activateTab,
  browserHost,
  browserUrl,
  closeOtherTabs,
  newTab,
} from "./browser-tabs.ts"
import { t, useLocale } from "./i18n/index.ts"
import type { PanelKind } from "./panel-model.ts"
import { closeBrowserTab, editBrowserColumn } from "./panel-state.ts"
import { openMenu } from "./rail-view.tsx"
import type { MenuItem } from "./ui.ts"
import {
  PTABS,
  PTABS_BOX,
  PTAB_LABEL,
  STROKE_ICON,
  iconButton,
  ptabClass,
  ptabCloseClass,
  ptabMainClass,
} from "./ui/panel.ts"

export function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className={`size-3.5 ${STROKE_ICON}`} viewBox="0 0 16 16" aria-hidden="true">
      {children}
    </svg>
  )
}

export const ICONS: Record<PanelKind, ReactNode> = {
  chat: (
    <path d="M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8l-3 2.5v-2.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1zM5 6.5h6M5 8.5h4" />
  ),
  files: <path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />,
  file: <path d="M4 2h5l3 3v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM9 2v3h3M5.5 8h5M5.5 10.5h5" />,
  diff: <path d="M3.5 2.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM8 5v4M6 7h4M6 11h4" />,
  browser: <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM2 8h12M8 2c2.2 2 2.2 10 0 12M8 2c-2.2 2-2.2 10 0 12" />,
  quota: <path d="M2 10a6 6 0 1 1 12 0M8 10l2.5-3.5M4 13h8" />,
}

function label(tab: BrowserTab): string {
  const url = browserUrl(tab)
  return url ? browserHost(url) : t("panel.browser")
}

/** The row's font is 12px mono: one column per ASCII character, two for wide ones (CJK). */
const COLUMN_PX = 7.3
/** Padding and the × slot around a tab's label; and the cap from `.ptab`'s max-width. */
const TAB_CHROME_PX = 22
const TAB_MAX_PX = 160
/** The tab row's gap, and the + beside it. */
const TAB_GAP_PX = 2
const NEW_TAB_PX = 24

/** Whether every tab fits at its full label; past that, the row goes compact (only the shown tab keeps its name). */
export function tabsFit(labels: readonly string[], width: number): boolean {
  let total = 0
  for (const text of labels) {
    let columns = 0
    for (const ch of text) columns += (ch.codePointAt(0) ?? 0) > 0x2e7f ? 2 : 1
    total += Math.min(TAB_MAX_PX, TAB_CHROME_PX + columns * COLUMN_PX) + TAB_GAP_PX
  }
  return total <= width
}

function tabMenu(taskId: string, column: BrowserColumn, tab: BrowserTab): MenuItem[] {
  const items: MenuItem[] = [{ label: t("panel.close"), section: "close", run: () => closeBrowserTab(taskId, tab.id) }]
  if (column.tabs.length > 1) {
    items.push({
      label: t("panel.closeOthers"),
      section: "close",
      run: () => editBrowserColumn(taskId, (col) => closeOtherTabs(col, tab.id)),
    })
  }
  return items
}

export function BrowserTabStrip({ taskId, column }: { taskId: string; column: BrowserColumn }) {
  useLocale()
  const box = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  // The box fills the head up to its buttons, so its width is the room the column gives the tabs.
  const [room, setRoom] = useState(0)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const watch = new ResizeObserver(([entry]) => setRoom(entry?.contentRect.width ?? 0))
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  const compact = room > 0 && !tabsFit(column.tabs.map(label), room - NEW_TAB_PX)
  // The shown tab stays in view when the row scrolls.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `active`, the tab count and compaction are what move the shown tab
  useEffect(() => {
    strip.current?.querySelector(".is-active")?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [column.active, column.tabs.length, compact])

  return (
    <div className={PTABS_BOX} ref={box}>
      <div className={PTABS} role="tablist" aria-label={t("panel.tabs")} ref={strip}>
        {column.tabs.map((tab) => {
          const active = tab.id === column.active
          return (
            <div
              key={tab.id}
              role="presentation"
              className={ptabClass({ active, compact })}
              onMouseDown={(e) => {
                if (e.button === 1) e.preventDefault()
              }}
              onAuxClick={(e) => {
                if (e.button !== 1) return
                e.preventDefault()
                closeBrowserTab(taskId, tab.id)
              }}
              onContextMenu={(e) => openMenu(e, tabMenu(taskId, column, tab))}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className={ptabMainClass(active)}
                title={browserUrl(tab) || label(tab)}
                onClick={() => editBrowserColumn(taskId, (col) => activateTab(col, tab.id))}
              >
                <span className={PTAB_LABEL}>{label(tab)}</span>
              </button>
              <button
                type="button"
                className={ptabCloseClass(active)}
                aria-label={t("panel.close")}
                tabIndex={-1}
                onClick={() => closeBrowserTab(taskId, tab.id)}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        className={iconButton({ tool: true })}
        title={t("panel.new")}
        aria-label={t("panel.new")}
        onClick={() => editBrowserColumn(taskId, newTab)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 3.5v9M3.5 8h9" />
        </svg>
      </button>
    </div>
  )
}
