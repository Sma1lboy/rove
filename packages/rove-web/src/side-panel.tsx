/**
 * The panel beside the task terminal: a row of buttons along its top (Files, Diff, Browser) and the
 * chosen view below. The views stay mounted once opened, so switching away and back keeps the page's
 * place and the diff's scroll. In narrow mode the bar's Terminal/Files/Diff/Browser switch picks the
 * view and this renders just the content.
 */

import { type PointerEvent, type ReactNode, useRef } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import { BrowserView } from "./browser-view.tsx"
import { FilesView } from "./files-view.tsx"
import { t, useLocale } from "./i18n/index.ts"
import {
  PANEL_TABS,
  type PanelTab,
  RAIL_DEFAULT_PX,
  clampPanelWidth,
  clampRailWidth,
  panelOpen,
  panelWidth,
  railFolded,
  railWidth,
} from "./layout.ts"
import { RemoteNotice } from "./machines-view.tsx"
import type { AppModel } from "./model.ts"
import { closeDiff, openDiff, showPanel, usePanelTab } from "./panel-state.ts"
import { PreviewView } from "./preview-view.tsx"
import { PaneIcon } from "./rail-chrome.tsx"
import { useStore } from "./store.ts"
import { preview, zen } from "./ui.ts"

const LABEL = { files: "panel.files", diff: "panel.diff", browser: "panel.browser" } as const

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="panel-icon" viewBox="0 0 16 16" aria-hidden="true">
      {children}
    </svg>
  )
}

const ICONS: Record<PanelTab, ReactNode> = {
  files: <path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />,
  diff: <path d="M8 3v6M5 6h6M5 12.5h6" />,
  browser: <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM2 8h12M8 2c2.2 2 2.2 10 0 12M8 2c-2.2 2-2.2 10 0 12" />,
}

/** The workspace's top-right button: shows or hides the panel. Zen hides it too, so showing it leaves zen. */
export function PanelToggle() {
  useLocale()
  const open = useStore(panelOpen)
  const zenOn = useStore(zen)
  return (
    <button
      type="button"
      className="rail-bar-btn panel-toggle"
      title={t("panel.toggle")}
      aria-label={t("panel.toggle")}
      onClick={() => {
        panelOpen.set(zenOn || !open)
        if (zenOn) zen.set(false)
      }}
    >
      <PaneIcon side="right" />
    </button>
  )
}

/** The panel's left edge: drag to pin a width, double-click to go back to the automatic one. */
function PanelGrip({ panel }: { panel: React.RefObject<HTMLElement | null> }) {
  useLocale()
  const drag = useRef<{ x: number; width: number } | null>(null)
  const down = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, width: panel.current?.getBoundingClientRect().width ?? 0 }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const from = drag.current
    if (!from || e.clientX === from.x) return
    const railPx = railFolded.get() ? 0 : clampRailWidth(railWidth.get() ?? RAIL_DEFAULT_PX)
    panelWidth.set(clampPanelWidth(from.width - (e.clientX - from.x), railPx))
  }
  return (
    <div
      className="rail-grip panel-grip"
      title={t("panel.resize")}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={() => {
        drag.current = null
      }}
      onDoubleClick={() => panelWidth.set(null)}
    />
  )
}

function DiffView({ model, task }: { model: AppModel; task: TaskRow }) {
  const view = useStore(preview)
  const shown = view && view.taskId === task.id ? view : null
  if (!shown) {
    return (
      <div className="side-empty">
        <p>{t("panel.diffEmpty")}</p>
        <button
          type="button"
          className="button"
          onClick={() => openDiff({ taskId: task.id, path: ".", scope: "working" })}
        >
          {t("files.diffAllTouch")}
        </button>
      </div>
    )
  }
  return (
    <>
      <div className="side-diff-head">
        <span className="side-diff-path" title={shown.path}>
          {shown.path === "." ? t("preview.whole") : shown.path}
        </span>
        <button type="button" className="tab-close" aria-label={t("preview.close")} onClick={() => closeDiff(task.id)}>
          ×
        </button>
      </div>
      <PreviewView key={`${shown.taskId}:${shown.path}:${shown.scope}`} model={model} view={shown} />
    </>
  )
}

function TaskPanel({ model, task, narrow }: { model: AppModel; task: TaskRow; narrow: boolean }) {
  useLocale()
  const tab = usePanelTab(task.id, narrow)
  const panel = useRef<HTMLElement>(null)
  // A view mounts when first shown and then stays, hidden, so it keeps its state.
  const seen = useRef(new Set<PanelTab>(["files"]))
  seen.current.add(tab)
  return (
    <aside className={`side-panel ${narrow ? "is-narrow" : ""}`} ref={panel}>
      {!narrow && <PanelGrip panel={panel} />}
      {!narrow && (
        <div className="side-head" role="tablist" aria-label={t("panel.tabs")}>
          {PANEL_TABS.map((id) => (
            <button
              type="button"
              role="tab"
              key={id}
              aria-selected={tab === id}
              className={`tab ${tab === id ? "is-active" : ""}`}
              onClick={() => showPanel(task.id, id)}
            >
              <Icon>{ICONS[id]}</Icon>
              {t(LABEL[id])}
            </button>
          ))}
        </div>
      )}
      <div className="side-body">
        <div className="side-view" hidden={tab !== "files"}>
          <FilesView model={model} task={task} narrow={narrow} />
        </div>
        {seen.current.has("diff") && (
          <div className="side-view" hidden={tab !== "diff"}>
            <DiffView model={model} task={task} />
          </div>
        )}
        {seen.current.has("browser") && (
          <div className="side-view" hidden={tab !== "browser"}>
            <BrowserView taskId={task.id} />
          </div>
        )}
      </div>
    </aside>
  )
}

/**
 * Desktop: the grid's right column, hidden by zen or the toggle. A task on another machine has no
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
    <aside className="side-panel">
      <RemoteNotice host={remoteHost} />
    </aside>
  )
}
