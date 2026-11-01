/**
 * The panel beside the task terminal: the task's tabs (Files, a diff, a Browser) in one group, or in
 * two stacked groups with a divider. Every view opened stays mounted while another is up, so the
 * page keeps its place and the diff its scroll. In narrow mode the bar's Terminal/Files/Diff/Browser
 * switch picks the kind and this renders its latest tab.
 */

import { type PointerEvent, type RefObject, useEffect, useRef } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import { BrowserView } from "./browser-view.tsx"
import { FilesView } from "./files-view.tsx"
import { t, useLocale } from "./i18n/index.ts"
import { RemoteNotice } from "./machines-view.tsx"
import type { AppModel } from "./model.ts"
import { type PanelKind, clampPanelWidth, narrowView, panelExpanded, panelOpen, panelWidth } from "./panel-layout.ts"
import {
  type PanelItem,
  allTabs,
  findTab,
  groupsOf,
  latestOfKind,
  mountedTabs,
  navigate,
  setRatio,
  showKind,
  stepBrowser,
} from "./panel-model.ts"
import { closePanelTab, editPanel, useTaskPanel } from "./panel-state.ts"
import { PanelTabRow } from "./panel-tabs.tsx"
import { PreviewView } from "./preview-view.tsx"
import { RAIL_DEFAULT_PX, clampRailWidth, railFolded, railWidth } from "./rail-layout.ts"
import { useStore } from "./store.ts"
import { dragLayout, zen } from "./ui.ts"
import { SIDE_BODY, SIDE_DIVIDER, SIDE_EMPTY, SIDE_VIEW, iconButton, sidePanelClass } from "./ui/panel.ts"
import { ResizeGrip } from "./ui/resize-grip.tsx"

/** The top row's end: stretch the panel over the terminal's column (and back), or close it; its tabs stay. */
function PanelWindowButtons() {
  useLocale()
  const expanded = useStore(panelExpanded)
  const label = expanded ? t("panel.restore") : t("panel.expand")
  return (
    <>
      <button
        type="button"
        className={iconButton({ tool: true })}
        title={label}
        aria-label={label}
        aria-pressed={expanded}
        onClick={() => panelExpanded.set(!expanded)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d={
              expanded
                ? "M13.5 6.5h-4v-4M2.5 9.5h4v4M9.5 6.5l4-4M6.5 9.5l-4 4"
                : "M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5l-4.5 4.5M2.5 13.5 7 9"
            }
          />
        </svg>
      </button>
      <button
        type="button"
        className={iconButton({ tool: true })}
        title={t("panel.hide")}
        aria-label={t("panel.hide")}
        onClick={() => panelOpen.set(false)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </>
  )
}

/** The panel's left edge: drag to pin a width, double-click to go back to the automatic one. */
function PanelGrip({ panel }: { panel: RefObject<HTMLElement | null> }) {
  useLocale()
  const drag = useRef<{ x: number; width: number } | null>(null)
  const down = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, width: panel.current?.getBoundingClientRect().width ?? 0 }
    // A frame under the pointer would swallow the drag.
    panel.current?.classList.add("is-resizing")
    e.currentTarget.setPointerCapture(e.pointerId)
    dragLayout(true)
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const from = drag.current
    if (!from || e.clientX === from.x) return
    const railPx = railFolded.get() ? 0 : clampRailWidth(railWidth.get() ?? RAIL_DEFAULT_PX)
    panelWidth.set(clampPanelWidth(from.width - (e.clientX - from.x), railPx))
  }
  return (
    <ResizeGrip
      edge="left"
      title={t("panel.resize")}
      onPointerDown={down}
      onPointerMove={move}
      onLostPointerCapture={() => {
        drag.current = null
        panel.current?.classList.remove("is-resizing")
        dragLayout(false)
      }}
      onDoubleClick={() => panelWidth.set(null)}
    />
  )
}

/** The line between the stacked groups: drag to give one more height, double-click to halve. */
function PanelDivider({ taskId, body }: { taskId: string; body: RefObject<HTMLElement | null> }) {
  useLocale()
  const dragging = useRef(false)
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const box = body.current?.getBoundingClientRect()
    const heads = body.current?.querySelectorAll(".side-head")
    if (!dragging.current || !box || heads?.length !== 2) return
    const first = heads[0]?.getBoundingClientRect()
    const second = heads[1]?.getBoundingClientRect()
    if (!first || !second) return
    const line = e.currentTarget.getBoundingClientRect().height
    // The views share the height left by the two tab rows and the line.
    const room = box.bottom - first.bottom - second.height - line
    if (room > 0) editPanel(taskId, (p) => setRatio(p, (e.clientY - first.bottom - line / 2) / room))
  }
  return (
    <div
      className={SIDE_DIVIDER}
      title={t("panel.resizeSplit")}
      onPointerDown={(e) => {
        dragging.current = true
        // A frame under the pointer would swallow the drag.
        body.current?.classList.add("is-resizing")
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={move}
      onLostPointerCapture={() => {
        dragging.current = false
        body.current?.classList.remove("is-resizing")
      }}
      onDoubleClick={() => editPanel(taskId, (p) => setRatio(p, 0.5))}
    />
  )
}

function TabView({
  model,
  task,
  tab,
  narrow,
  active,
  restored,
}: { model: AppModel; task: TaskRow; tab: PanelItem; narrow: boolean; active: boolean; restored: boolean }) {
  if (tab.kind === "files") return <FilesView model={model} task={task} narrow={narrow} />
  if (tab.kind === "diff") {
    return (
      <PreviewView
        key={`${task.id}:${tab.path}:${tab.scope}`}
        model={model}
        view={{ taskId: task.id, path: tab.path, scope: tab.scope }}
        active={active}
        restored={restored}
        onClose={() => closePanelTab(task.id, tab.id)}
      />
    )
  }
  return (
    <BrowserView
      model={model}
      tab={tab}
      onNavigate={(url) => editPanel(task.id, (p) => navigate(p, tab.id, url))}
      onStep={(at) => editPanel(task.id, (p) => stepBrowser(p, tab.id, at))}
    />
  )
}

function TaskPanel({ model, task, narrow }: { model: AppModel; task: TaskRow; narrow: boolean }) {
  useLocale()
  const panel = useTaskPanel(task.id)
  const narrowKind = useStore(narrowView)
  const expanded = useStore(panelExpanded)
  const aside = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const kind: PanelKind = narrowKind === "terminal" ? "files" : narrowKind
  const tabs = allTabs(panel)
  const latest = narrow ? latestOfKind(panel, kind) : null
  // The phone's panel shows one tab: the latest of the chosen kind, opening one when there is none.
  useEffect(() => {
    if (narrow && !latest) editPanel(task.id, (p) => showKind(p, kind))
  }, [narrow, latest, kind, task.id])

  const visible = narrow
    ? latest
      ? [latest.id]
      : []
    : groupsOf(panel).flatMap(([, group]) => (group.active ? [group.active] : []))
  // A view mounts when first shown and then stays, hidden, so it keeps its state.
  const mounted = useRef<string[]>([])
  mounted.current = mountedTabs(mounted.current, visible, tabs)
  // Tabs on screen when the panel first drew were restored, not opened: they leave the keyboard alone.
  const restored = useRef(new Set(visible))

  const split = !narrow && panel.bottom !== null
  const rows = split
    ? `auto minmax(0, ${panel.ratio * 100}fr) var(--divider) auto minmax(0, ${(1 - panel.ratio) * 100}fr)`
    : "auto minmax(0, 1fr)"
  const ofKind = tabs.filter((tab) => tab.kind === kind)
  const empty = !narrow && panel.top.tabs.length === 0

  return (
    <aside className={sidePanelClass(narrow)} ref={aside}>
      {!narrow && !expanded && <PanelGrip panel={aside} />}
      <div className={SIDE_BODY} ref={body} style={{ gridTemplateRows: rows }}>
        {narrow
          ? (ofKind.length > 1 || kind === "diff") && (
              <PanelTabRow
                taskId={task.id}
                panel={panel}
                group="top"
                tabs={ofKind}
                active={latest?.id ?? null}
                narrow
              />
            )
          : groupsOf(panel).map(([name, group]) => (
              <PanelTabRow
                key={name}
                taskId={task.id}
                panel={panel}
                group={name}
                tabs={group.tabs}
                active={group.active}
                narrow={false}
              >
                {name === "top" && <PanelWindowButtons />}
              </PanelTabRow>
            ))}
        {empty && <p className={SIDE_EMPTY}>{t("panel.empty")}</p>}
        {split && <PanelDivider taskId={task.id} body={body} />}
        {tabs
          .filter((tab) => mounted.current.includes(tab.id))
          .map((tab) => (
            <div
              key={tab.id}
              className={SIDE_VIEW}
              hidden={!visible.includes(tab.id)}
              style={{ gridRow: findTab(panel, tab.id)?.name === "bottom" && !narrow ? 5 : 2 }}
            >
              <TabView
                model={model}
                task={task}
                tab={tab}
                narrow={narrow}
                active={visible.includes(tab.id)}
                restored={restored.current.has(tab.id)}
              />
            </div>
          ))}
      </div>
    </aside>
  )
}

/**
 * Desktop: the grid's right column, hidden by zen or by closing it. A task on another machine has no
 * files or page here, so its panel says where it lives. Narrow: the task's chosen view, in the pane.
 */
export function SidePanel({
  model,
  task,
  remoteHost,
  narrow = false,
}: {
  model: AppModel
  task: TaskRow | null
  remoteHost?: string
  narrow?: boolean
}) {
  const zenOn = useStore(zen)
  const open = useStore(panelOpen)
  if (!narrow && (zenOn || !open)) return null
  if (task) return <TaskPanel key={task.id} model={model} task={task} narrow={narrow} />
  if (!remoteHost) return null
  return (
    <aside className={sidePanelClass(false)}>
      <RemoteNotice host={remoteHost} />
    </aside>
  )
}
