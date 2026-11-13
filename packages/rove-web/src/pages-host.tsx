/**
 * The rail's page destinations (TUI `SidebarNavRail` + `nav-core.ts`): Kanban, Routines,
 * Issues, under New task. Kanban and Issues are first-party mods, listed only
 * while installed. A page takes over the workspace; selecting a task
 * brings the terminal back, as picking a task in the TUI rail leaves the page.
 */

import { CompareView } from "./compare-view.tsx"
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
import { RAIL_NAV } from "./ui/page.ts"
import { RailNavRow } from "./ui/rail-nav.tsx"
import { UsageView } from "./usage-page.tsx"

interface NavItem {
  readonly id: PageId & ("kanban" | "routines" | "issues" | "mods")
  /** A TUI `tasks.nav` key. */
  readonly label: "kanban" | "automations" | "issues" | "mods"
  /** The first-party mod that has to be installed for this row to show. */
  readonly mod?: "kanban" | "issues"
}

const MODS_NAV: NavItem = { id: "mods", label: "mods" }

const NAV: readonly NavItem[] = [
  { id: "kanban", label: "kanban", mod: "kanban" },
  { id: "routines", label: "automations" },
  { id: "issues", label: "issues", mod: "issues" },
]

export function PageNav({ model }: { model: AppModel }) {
  const { nav } = useCopy()
  const open = useStore(page)
  // As the TUI rail: Mods is a destination only while some mod has a pane open.
  const hasMods = useStore(model.mods).length > 0
  const installed = useStore(model.installedMods)
  const shown = NAV.filter((item) => !item.mod || installed.has(item.mod))
  const items = [...shown, ...(hasMods ? [MODS_NAV] : [])]
  return (
    <div className={RAIL_NAV}>
      {/* Starting a task is the first destination, drawn like the pages under it. */}
      <RailNavRow plus onSelect={() => startNewTask()}>
        {t("rail.newTask")}
      </RailNavRow>
      {items.map((item) => (
        <RailNavRow key={item.id} active={open === item.id} onSelect={() => openPage(item.id)}>
          {nav[item.label]}
        </RailNavRow>
      ))}
    </div>
  )
}

export function PagesHost({ model, page: current }: { model: AppModel; page: PageId }) {
  const installed = useStore(model.installedMods)
  return current === "kanban" && installed.has("kanban") ? (
    <KanbanView model={model} />
  ) : current === "routines" ? (
    <RoutinesView model={model} />
  ) : current === "issues" && installed.has("issues") ? (
    <IssuesView model={model} />
  ) : current === "mods" ? (
    <ModsView model={model} />
  ) : current === "compare" ? (
    <CompareView model={model} />
  ) : current === "usage" ? (
    <UsageView model={model} />
  ) : null
}
