/** The Tasks rail: wordmark + inbox count, then project → task → child task rows (TUI `tree-panel`). */

import { en as tasksEn, zh as tasksZh } from "@sma1lboy/rove/src/i18n/messages/tasks.ts"
import type { MouseEvent } from "react"
import { useRef } from "react"
import type { TasksPayload } from "rove-bridge/protocol"
import { useEngineIcons } from "./engine-icons.ts"
import { t, useLocale } from "./i18n/index.ts"
import { InboxDialog } from "./inbox-view.tsx"
import { enterWorkspace } from "./layout.ts"
import { rowCloud, useMachines } from "./machines-view.tsx"
import type { AppModel } from "./model.ts"
import { moveMode } from "./move-mode.ts"
import { startNewTask, startNewUngrouped } from "./new-session-view.tsx"
import { PageNav } from "./pages-host.tsx"
import { ShortcutBadge } from "./prefix-guide.tsx"
import { treeGuides } from "./rail-blocks.ts"
import { RailGrip, RecentRow } from "./rail-chrome.tsx"
import { useRowDrag } from "./rail-drag.ts"
import { RailFoot } from "./rail-foot.tsx"
import { mostUrgentStatus } from "./rail-glyphs.ts"
import { railGroup } from "./rail-group.ts"
import { openTaskRow, useRailFilters, useRailKeys } from "./rail-keys.ts"
import { repoLabel } from "./rail-labels.ts"
import { peekRail, railFolded, railPeek } from "./rail-layout.ts"
import { PaneRowView, openPane } from "./rail-pane-row.tsx"
import { withPanes } from "./rail-panes.ts"
import { PhoneExtensions, PhoneRailNote, PhoneRailRow, PhoneRoutines } from "./rail-phone.tsx"
import { pickClick, pickEscape, pickRowMenu, railPick } from "./rail-pick.tsx"
import { RoundRowView } from "./rail-round-row.tsx"
import { RailRow } from "./rail-row.tsx"
import { SearchChip } from "./rail-search.tsx"
import { railStateRows, rowRepo } from "./rail-states.ts"
import { type NavRow, type RowFold, foldProjects, railRows } from "./rail.ts"
import { type ProjectInfo, projectMenu, rowSwipe, taskMenu, ungroupedMenu } from "./row-actions.tsx"
import { SettingsDialog } from "./settings-view.tsx"
import { paneEdits, taskSplitItems } from "./split-actions.tsx"
import { useStatusMarkNotice } from "./status-mark-notice.ts"
import { useStore } from "./store.ts"
import { tc } from "./tui-copy.ts"
import { type MenuItem, dialog, menu, page, tuckRare } from "./ui.ts"
import { Legend } from "./ui/legend.tsx"
import { INBOX_CHIP } from "./ui/overlay.ts"
import { RAIL, RAIL_EMPTY, RAIL_HEAD, RAIL_SEARCH, railBody } from "./ui/rail.ts"
import { RefreshRoveButton } from "./ui/refresh-rove-button.tsx"
import { BRACKET, HEAD_CHIP, WORDMARK } from "./ui/shell.ts"
import { UpdateChip } from "./update-view.tsx"
import { WelcomePane } from "./welcome-view.tsx"

/** Right click opens the row's menu where the pointer is (TUI tree menu). */
export function openMenu(e: MouseEvent, items: readonly MenuItem[]): void {
  e.preventDefault()
  // A keyboard contextmenu (Shift+F10) reports button 0; a right click reports 2.
  menu.set({ x: e.clientX, y: e.clientY, items, target: e.currentTarget as Element, fromKeyboard: e.button !== 2 })
}

export function RailView({ model, narrow }: { model: AppModel; narrow: boolean }) {
  const locale = useLocale()
  const payload: TasksPayload | null = useStore(model.tasks)
  const remoteTasks = useStore(model.remote)
  const machines = useMachines(model)
  const tabs = useStore(model.tabs)
  const engineIcons = useEngineIcons(model)
  useStatusMarkNotice(model, payload?.tasks.length)
  const selection = useStore(model.selection)
  const tasks = payload?.tasks ?? []
  const unread = payload?.attention.filter((row) => row.unread).length ?? 0
  const selectedId = selection.taskId
  const activeTaskId = useStore(page) === null ? selectedId : null
  const byId = new Map([...tasks, ...remoteTasks].map((task) => [task.id, task]))

  const filters = useRailFilters()
  const moving = useStore(moveMode)
  const picked = useStore(railPick).ids
  const byState = useStore(railGroup) === "state"
  const build = (query: string) =>
    (byState ? railStateRows : railRows)({
      tasks,
      remote: remoteTasks,
      machines,
      sort: filters.sort,
      query,
      fold: { ...filters.hand, selectedId: selectedId ?? undefined },
    })
  const built = build(filters.search.active ? filters.search.query : "")
  const { groups } = built
  // A collapsed project keeps its header and hides what is under it; search shows everything.
  // Archived tasks are not listed: the palette finds them by title and brings one back.
  const rows = filters.search.active ? built.rows : foldProjects(withPanes(built.rows, tabs), filters.collapsed)
  const stops = (all: readonly NavRow[]) =>
    all.filter((row) => row.kind !== "project" && row.kind !== "state" && row.kind !== "round")
  const words = (locale === "zh" ? tasksZh : tasksEn).machine
  const offline = new Set(machines.filter((m) => m.state !== "online").map((m) => m.alias))
  // This machine's projects in rail order: the ones a header menu can move among.
  const movable = groups.filter((group) => !group.noProject && group.machine === undefined).map((group) => group.repo)
  const projectInfo = (repo: string): ProjectInfo => {
    const at = movable.indexOf(repo)
    return {
      label: repoLabel(repo),
      local: at >= 0,
      top: at > 0 ? (movable[0] ?? null) : null,
      above: at > 0 ? (movable[at - 1] ?? null) : null,
      below: at >= 0 ? (movable[at + 1] ?? null) : null,
    }
  }
  const drag = useRowDrag(model, tasks, !filters.search.active && !byState, filters.sort === "default")
  const { place, dragging } = drag.places(rows)
  const openSettings = () => dialog.set(<SettingsDialog model={model} />)
  const openInbox = () => dialog.set(<InboxDialog model={model} />)
  const keys = useRailKeys(model, rows, filters, { selectedId, onNewTask: startNewTask, onSettings: openSettings })
  const total = stops(build("").rows).length
  const rail = useRef<HTMLElement>(null)
  // Folded, the rail stays mounted and slides off to the left; inert so nothing in it takes focus or clicks,
  // until a hover at the page's left edge floats it back over the workspace.
  const folded = useStore(railFolded) && !narrow
  const peek = useStore(railPeek) && folded
  const recent = narrow ? (tasks.find((task) => task.id === selection.taskId && !task.deleting) ?? null) : null
  const Row = narrow ? PhoneRailRow : RailRow

  return (
    <nav
      className={`${RAIL} ${folded ? "is-folded" : ""}`}
      ref={rail}
      inert={folded && !peek}
      aria-hidden={folded && !peek}
      onMouseEnter={folded ? () => peekRail(true) : undefined}
      onMouseLeave={folded ? () => peekRail(false) : undefined}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the rail takes the TUI sidebar's keys while focused
      tabIndex={0}
      onKeyDown={(e) => pickEscape(e) || keys.onKeyDown(e)}
    >
      <header className={RAIL_HEAD}>
        <span className={`${WORDMARK} mr-auto`}>
          <span className={BRACKET}>[</span> rove <span className={BRACKET}>]</span>
        </span>
        {!narrow && (
          <span className="relative">
            <button
              type="button"
              className={`m-0 text-meta font-medium normal-nums inbox-chip relative ${INBOX_CHIP} ${HEAD_CHIP} ${unread > 0 ? "text-accent" : "text-muted"}`}
              onClick={openInbox}
            >
              {t("rail.inbox", { count: unread })}
            </button>
            <ShortcutBadge model={model} bindingId="inbox.show" head />
          </span>
        )}
        {!narrow && <UpdateChip />}
        {!narrow && <RefreshRoveButton client={model.client} railBar />}
        {narrow && <PhoneRoutines model={model} />}
        {narrow && <PhoneExtensions model={model} />}
      </header>
      {/* A phone's header has no room beside its buttons: the update notices get a line of their own. */}
      {narrow && (
        <div className="-mt-1 flex items-center gap-2 px-4 pb-2 empty:hidden">
          <UpdateChip />
          <RefreshRoveButton client={model.client} />
        </div>
      )}
      {narrow && payload && <PhoneRailNote model={model} />}
      {moving && (
        <div className={`${RAIL_SEARCH} mono`}>
          <span className="text-accent">{tc("tasks", "moveChip").trim()}</span>
          <span className="keys-only ml-1.5 text-muted">
            <Legend text={t("taskops.moveHint")} />
          </span>
        </div>
      )}
      {filters.search.active && (
        <SearchChip
          query={filters.search.query}
          count={`${stops(rows).length}/${total}`}
          onChange={(query) => filters.setSearch((s) => ({ ...s, query }))}
        />
      )}
      {/* A phone reaches pages from the buttons beside the wordmark and its bottom bar. */}
      {!narrow && <PageNav model={model} />}
      <div data-rail-body className={railBody(dragging !== null)} {...drag.body} onPointerDownCapture={keys.onPress}>
        {payload && tasks.length === 0 && remoteTasks.length === 0 && narrow && <WelcomePane model={model} />}
        {payload && tasks.length === 0 && remoteTasks.length === 0 && !narrow && (
          <p className={RAIL_EMPTY}>{t("rail.empty")}</p>
        )}
        {recent && <RecentRow title={recent.title} />}
        {rows.map((row, i) =>
          row.kind === "round" ? (
            <RoundRowView
              key={row.id}
              row={row}
              guides={row.depth > 1 ? treeGuides(rows, i) : undefined}
              repo={byState && row.depth === 1 ? rowRepo(row.tasks[0]) : undefined}
              cursor={row.id === keys.cursor}
              place={place(row)}
              onClick={() => keys.setCursor(row.id)}
            />
          ) : row.kind === "pane" ? (
            <PaneRowView
              key={row.id}
              selectedTabId={row.task.id === activeTaskId ? selection.tabId : null}
              row={row}
              guides={treeGuides(rows, i)}
              cursor={row.id === keys.cursor}
              place={place(row)}
              onClick={() => {
                keys.setCursor(row.id)
                openPane(model, row)
                enterWorkspace()
              }}
              onMenu={(e) => {
                keys.setCursor(row.id)
                openMenu(e, paneEdits(model, row.task.id, row.tab, row.leaf))
              }}
            />
          ) : (
            <Row
              key={row.id}
              row={row}
              guides={row.kind === "task" && row.depth > 1 ? treeGuides(rows, i) : undefined}
              cloud={rowCloud(row, machines, words)}
              repo={byState && row.kind === "task" && row.depth === 1 ? rowRepo(row.task) : undefined}
              tabs={row.kind === "task" ? tabs[row.task.id] : undefined}
              engineIcon={row.kind === "task" ? engineIcons.get(row.task.engine?.id ?? "") : undefined}
              selected={row.id === activeTaskId}
              cursor={row.id === keys.cursor && dragging === null}
              stale={row.machine !== undefined && offline.has(row.machine)}
              collapsed={(row.kind === "project" || row.kind === "state") && filters.collapsed.has(row.id)}
              drag={drag.props(row)}
              swipe={
                narrow && row.kind === "task" && row.machine === undefined && !row.task.archived
                  ? rowSwipe(model, row.task)
                  : undefined
              }
              dragging={dragging === row.id}
              place={place(row)}
              onNewTask={
                row.kind === "project"
                  ? row.noProject
                    ? startNewUngrouped
                    : () => startNewTask(row.repo, row.machine)
                  : undefined
              }
              moving={
                picked.has(row.id) ||
                (moving && row.machine === undefined && row.kind !== "project" && row.id === keys.cursor)
              }
              prTasks={
                row.kind === "task"
                  ? [row.task, ...(row.fold?.descendantIds ?? []).flatMap((id) => byId.get(id) ?? [])]
                  : undefined
              }
              rollup={
                row.kind === "task" && row.fold?.collapsed
                  ? mostUrgentStatus([row.task, ...row.fold.descendantIds.flatMap((id) => byId.get(id) ?? [])])
                  : undefined
              }
              onToggleFold={() => {
                if (row.kind === "task") filters.toggleTaskFold(row.id, row.fold?.collapsed === true)
              }}
              onClick={(e) => {
                if (row.kind === "task" && e && pickClick(e, row.id, rows, activeTaskId)) return
                keys.setCursor(row.id)
                if (row.kind === "project" || row.kind === "state") filters.toggleProject(row.id)
                if (row.kind === "task") openTaskRow(model, row.task.id)
              }}
              onMenu={(e) => {
                // Another machine's project has no checkout here, so its header has no menu; its
                // tasks do (their verbs run on that machine, `taskMenu` drops the local-only ones).
                if (row.kind === "project" && row.machine !== undefined) return
                // Ungrouped is no repo: it offers only its two starts.
                if (row.kind === "project" && row.noProject) {
                  openMenu(e, ungroupedMenu(model))
                  return
                }
                if (row.kind === "project") {
                  openMenu(e, projectMenu(model, row.repo, projectInfo(row.repo)))
                  return
                }
                if (row.kind !== "task") return
                keys.setCursor(row.id)
                const many = pickRowMenu(model, row.id, rows)
                if (many) return openMenu(e, many)
                openMenu(
                  e,
                  tuckRare(
                    withSplitEntries(
                      withFoldEntry(taskMenu(model, row.task, null), row.fold, () =>
                        filters.toggleTaskFold(row.id, row.fold?.collapsed === true),
                      ),
                      taskSplitItems(model, row.task.id),
                    ),
                    t("menu.more"),
                  ),
                )
              }}
            />
          ),
        )}
      </div>
      <RailFoot model={model} narrow={narrow} onSettings={openSettings} inbox={{ count: unread, onClick: openInbox }} />
      {!narrow && !folded && <RailGrip rail={rail} />}
    </nav>
  )
}

export type RailRowProps = Parameters<typeof RailRow>[0]

/** The fold entry sits with what opens the task, ahead of the edit and danger sections. */
function withFoldEntry(items: MenuItem[], fold: RowFold | undefined, toggle: () => void): MenuItem[] {
  if (!fold) return items
  const entry: MenuItem = {
    label: tc("tasks", fold.collapsed ? "menu.expandChildren" : "menu.collapseChildren"),
    section: "open",
    rare: true,
    run: toggle,
  }
  const at = items.map((item) => item.section).lastIndexOf("open")
  return [...items.slice(0, at + 1), entry, ...items.slice(at + 1)]
}

/** Split right / down on the task's tab sit right after what opens the task: the tab strip is hidden by default, so this is the mouse route. */
function withSplitEntries(items: MenuItem[], entries: readonly MenuItem[]): MenuItem[] {
  const at = items.map((item) => item.section).lastIndexOf("open")
  return [...items.slice(0, at + 1), ...entries.map((entry) => ({ ...entry, rare: true })), ...items.slice(at + 1)]
}
