/**
 * One column of the side panel: its slim header (a title, or the Browser's tab strip, then expand and
 * close at the right), its view, and the divider that sits between two columns.
 */

import { type PointerEvent, type RefObject, useRef } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import { engineColorForPack } from "./appearance/apply.ts"
import { AppearanceSlot } from "./appearance/declarative.tsx"
import { useActiveAppearancePack } from "./appearance/runtime.ts"
import { type BrowserColumn, browserUrl, mountedTabs, navigate, stepTab } from "./browser-tabs.ts"
import { BrowserView } from "./browser-view.tsx"
import { ContextView } from "./context-view.tsx"
import { FilesView } from "./files-view.tsx"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { panelExpanded } from "./panel-layout.ts"
import {
  COLUMN_MIN_PX,
  type Column,
  type PanelKind,
  diffName,
  moveDivider,
  resetWidths,
  setWidths,
} from "./panel-model.ts"
import { closeBrowserTab, closePanelColumn, editBrowserColumn, editPanel } from "./panel-state.ts"
import { BrowserTabStrip } from "./panel-tabs.tsx"
import { PreviewHost } from "./preview-host.tsx"
import { useStore } from "./store.ts"
import { useMode } from "./task-colors.ts"
import { todoCount } from "./task-todos.ts"
import { TranscriptView } from "./transcript-view.tsx"
import { COLUMN_TITLE, SIDE_DIVIDER, SIDE_VIEW, iconButton, sideHeadClass } from "./ui/panel.ts"

const SCOPE_LABEL = {
  working: "review.scopeWorking",
  branch: "review.scopeBranch",
  task: "review.scopeTask",
} as const

/** A column's name in its header: the kind, or for a diff its file (the whole worktree: its scope). */
function title(col: Exclude<Column, BrowserColumn>): { text: string; hint: string } {
  if (col.kind !== "diff") return { text: t(`panel.${col.kind}`), hint: t(`panel.${col.kind}`) }
  if (col.path === ".") return { text: t(SCOPE_LABEL[col.scope]), hint: t("preview.whole") }
  return { text: diffName(col.path), hint: col.path }
}

function WindowButtons({ taskId, kind, expand }: { taskId: string; kind: PanelKind; expand: boolean }) {
  useLocale()
  const expanded = useStore(panelExpanded)
  const label = expanded ? t("panel.restore") : t("panel.expand")
  return (
    <>
      {expand && (
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
      )}
      <button
        type="button"
        className={iconButton({ tool: true })}
        title={t("panel.close")}
        aria-label={t("panel.close")}
        onClick={() => closePanelColumn(taskId, kind)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </>
  )
}

/**
 * Desktop: every column's header. A phone shows one column without a header, except the Browser's tabs
 * and a diff's name, which it needs to switch tabs and to leave.
 */
export function ColumnHead({ taskId, column, narrow }: { taskId: string; column: Column; narrow: boolean }) {
  useLocale()
  const expanded = useStore(panelExpanded)
  if (column.kind === "browser") {
    const head = (
      <div className={sideHeadClass(narrow)}>
        <BrowserTabStrip taskId={taskId} column={column} />
        {!narrow && <WindowButtons taskId={taskId} kind="browser" expand />}
      </div>
    )
    return (
      <AppearanceSlot
        slot="panel.tabs"
        data={{
          taskId,
          kind: "browser",
          title: t("panel.browser"),
          hint: t("panel.browser"),
          tabCount: column.tabs.length,
          expanded,
          onToggleExpand: narrow ? undefined : () => panelExpanded.set(!expanded),
          onClose: () => closePanelColumn(taskId, "browser"),
        }}
        fallback={head}
      />
    )
  }
  if (narrow && column.kind !== "diff") return null
  const { text, hint } = title(column)
  const head = (
    <div className={sideHeadClass(narrow)}>
      <span className={COLUMN_TITLE} title={hint}>
        {text}
      </span>
      <WindowButtons taskId={taskId} kind={column.kind} expand={!narrow} />
    </div>
  )
  return (
    <AppearanceSlot
      slot="panel.tabs"
      data={{
        taskId,
        kind: column.kind,
        title: text,
        hint,
        tabCount: 1,
        expanded,
        onToggleExpand: narrow ? undefined : () => panelExpanded.set(!expanded),
        onClose: () => closePanelColumn(taskId, column.kind),
      }}
      fallback={head}
    />
  )
}

const tabKey = (tab: BrowserColumn["tabs"][number]): string => `${tab.id}:${browserUrl(tab)}`

function BrowserTabs({
  model,
  task,
  column,
  restored,
}: { model: AppModel; task: TaskRow; column: BrowserColumn; restored: boolean }) {
  // A tab mounts when first shown and then stays, hidden, so its page keeps its place; past `MAX_FRAMES` the oldest go.
  const mounted = useRef<string[]>([])
  mounted.current = mountedTabs(mounted.current, column.active, column.tabs)
  // A file opened later in a restored column was asked for: only what the column first drew leaves the keyboard alone.
  const first = useRef(column.tabs.map(tabKey))
  return column.tabs
    .filter((tab) => mounted.current.includes(tab.id))
    .map((tab) => (
      <div key={tab.id} className={SIDE_VIEW} hidden={tab.id !== column.active}>
        <BrowserView
          model={model}
          taskId={task.id}
          tab={tab}
          root={task.workspace}
          shown={tab.id === column.active}
          restored={restored && first.current.includes(tabKey(tab))}
          onClose={() => closeBrowserTab(task.id, tab.id)}
          onNavigate={(url) => editBrowserColumn(task.id, (col) => navigate(col, tab.id, url))}
          onStep={(at) => editBrowserColumn(task.id, (col) => stepTab(col, tab.id, at))}
        />
      </div>
    ))
}

/** A column's view. `restored`: it was on screen when the panel first drew, so it leaves the keyboard alone. */
export function ColumnView({
  model,
  task,
  column,
  narrow,
  restored,
}: { model: AppModel; task: TaskRow; column: Column; narrow: boolean; restored: boolean }) {
  const pack = useActiveAppearancePack()
  const mode = useMode()
  const defaultBody =
    column.kind === "browser" ? (
      <BrowserTabs model={model} task={task} column={column} restored={restored} />
    ) : (
      <div className={SIDE_VIEW}>
        {column.kind === "files" && <FilesView model={model} task={task} narrow={narrow} />}
        {column.kind === "chat" && <TranscriptView model={model} task={task} active />}
        {column.kind === "quota" && <ContextView model={model} task={task} active />}
        {column.kind === "diff" && (
          <PreviewHost
            key={`${task.id}:${column.path}:${column.scope}:${column.at ?? ""}`}
            model={model}
            view={{ taskId: task.id, path: column.path, scope: column.scope }}
            active
            restored={restored}
            onClose={() => closePanelColumn(task.id, "diff")}
          />
        )}
      </div>
    )
  const diffStats =
    task.changes && !("unreadable" in task.changes)
      ? { files: 0, added: task.changes.added, removed: task.changes.deleted }
      : undefined
  const todos = todoCount(task) ?? undefined
  return (
    <AppearanceSlot
      slot="panel.section"
      data={{
        taskId: task.id,
        kind: column.kind,
        title: task.label,
        branch: task.branch || undefined,
        repo: task.repo ? task.repo.split("/").pop() : undefined,
        engineId: task.engine?.id ?? undefined,
        engineName: task.engine?.name,
        engineColor: engineColorForPack(pack?.manifest, task.engine?.id ?? undefined, mode),
        statusKind: task.rowStatus?.kind ?? "idle",
        diffStats,
        todos,
        pr: task.pr?.number ? { number: task.pr.number, state: task.pr.lifecycle, url: task.pr.url } : undefined,
      }}
      fallback={defaultBody}
    />
  )
}

/** The line between column `index` and the next: drag to move it, double-click to go back to the default widths. */
export function ColumnDivider({
  taskId,
  kinds,
  index,
  body,
  slot,
}: { taskId: string; kinds: readonly PanelKind[]; index: number; body: RefObject<HTMLElement | null>; slot: number }) {
  useLocale()
  const drag = useRef<{ x: number; widths: number[] } | null>(null)
  const down = (e: PointerEvent<HTMLDivElement>) => {
    const widths = kinds.map(
      (kind) => body.current?.querySelector(`[data-kind="${kind}"]`)?.getBoundingClientRect().width ?? 0,
    )
    drag.current = { x: e.clientX, widths }
    // A frame under the pointer would swallow the drag.
    body.current?.classList.add("is-resizing")
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const from = drag.current
    if (!from) return
    const widths = moveDivider(from.widths, index, e.clientX - from.x, COLUMN_MIN_PX)
    editPanel(taskId, (p) => setWidths(p, widths))
  }
  return (
    <div
      className={SIDE_DIVIDER}
      style={{ gridColumn: slot }}
      title={t("panel.resizeSplit")}
      onPointerDown={down}
      onPointerMove={move}
      onLostPointerCapture={() => {
        drag.current = null
        body.current?.classList.remove("is-resizing")
      }}
      onDoubleClick={() => editPanel(taskId, resetWidths)}
    />
  )
}
