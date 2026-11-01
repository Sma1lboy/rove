/**
 * The rail's page destinations (TUI `SidebarNavRail` + `nav-core.ts`): Kanban, Routines,
 * Issues and the web-only Dispatch, top to bottom, under the search row. Kanban and Issues are first-party mods, listed only
 * while installed. A page takes over the workspace; selecting a task
 * brings the terminal back, as picking a task in the TUI rail leaves the page.
 */

import { useEffect } from "react"
import { DispatchView } from "./dispatch-view.tsx"
import { t } from "./i18n/index.ts"
import { IssuesView } from "./issues-view.tsx"
import { KanbanView } from "./kanban-view.tsx"
import { openPage } from "./layout.ts"
import type { AppModel } from "./model.ts"
import { ModsView } from "./mods-view.tsx"
import { startNewTask } from "./new-session-view.tsx"
import { useCopy } from "./pages-kit.ts"
import { RoutinesView } from "./routines-view.tsx"
import { useStore } from "./store.ts"
import { type PageId, page } from "./ui.ts"
import { RAIL_NAV, RAIL_NAV_PLUS, railNavRowClass } from "./ui/page.ts"

interface NavItem {
  readonly id: PageId & ("kanban" | "routines" | "issues" | "mods" | "dispatch")
  /** A TUI `tasks.nav` key, or `dispatch`, which only the web has (`t("dispatch.nav")`). */
  readonly label: "kanban" | "automations" | "issues" | "mods" | "dispatch"
  /** The first-party mod that has to be installed for this row to show. */
  readonly mod?: "kanban" | "issues"
}

const MODS_NAV: NavItem = { id: "mods", label: "mods" }

const NAV: readonly NavItem[] = [
  { id: "kanban", label: "kanban", mod: "kanban" },
  { id: "routines", label: "automations" },
  { id: "issues", label: "issues", mod: "issues" },
  { id: "dispatch", label: "dispatch" },
]

export function PageNav({ model }: { model: AppModel }) {
  const { nav } = useCopy()
  const open = useStore(page)
  // As the TUI rail: Mods is a destination only while some mod has a pane open.
  const hasMods = useStore(model.mods).length > 0
  const installed = useStore(model.installedMods)
  const shown = NAV.filter((item) => !item.mod || installed.has(item.mod))
  const items = hasMods ? [...shown, MODS_NAV] : shown
  return (
    <div className={RAIL_NAV}>
      {/* Starting a task is the first destination, drawn like the pages under it. */}
      <button type="button" className={`rail-nav-row ${railNavRowClass(false)}`} onClick={() => startNewTask()}>
        {t("rail.newTask")}
        <span className={RAIL_NAV_PLUS} aria-hidden="true">
          +
        </span>
      </button>
      {items.map((item) => (
        <button
          type="button"
          key={item.id}
          className={`rail-nav-row ${railNavRowClass(open === item.id)}`}
          aria-current={open === item.id ? "page" : undefined}
          onClick={() => openPage(item.id)}
        >
          {item.label === "dispatch" ? t("dispatch.nav") : nav[item.label]}
        </button>
      ))}
    </div>
  )
}

export function PagesHost({ model, page: current }: { model: AppModel; page: PageId }) {
  // Choosing a task (or opening one from a page) leaves the page.
  useEffect(() => model.selection.subscribe(() => page.set(null)), [model])
  const installed = useStore(model.installedMods)
  return current === "kanban" && installed.has("kanban") ? (
    <KanbanView model={model} />
  ) : current === "routines" ? (
    <RoutinesView model={model} />
  ) : current === "issues" && installed.has("issues") ? (
    <IssuesView model={model} />
  ) : current === "mods" ? (
    <ModsView model={model} />
  ) : current === "dispatch" ? (
    <DispatchView model={model} />
  ) : null
}
