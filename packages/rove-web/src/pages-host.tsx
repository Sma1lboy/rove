/**
 * The rail's page destinations (TUI `SidebarNavRail` + `nav-core.ts`): Kanban, Routines and
 * Issues, top to bottom, under the search row. A page takes over the workspace; selecting a task
 * brings the terminal back, as picking a task in the TUI rail leaves the page.
 */

import "./pages.css"
import { useEffect } from "react"
import { IssuesView } from "./issues-view.tsx"
import { KanbanView } from "./kanban-view.tsx"
import type { AppModel } from "./model.ts"
import { useCopy } from "./pages-kit.ts"
import { RoutinesView } from "./routines-view.tsx"
import { useStore } from "./store.ts"
import { type PageId, page } from "./ui.ts"

const NAV: readonly {
  readonly id: PageId & ("kanban" | "routines" | "issues")
  readonly label: "kanban" | "automations" | "issues"
}[] = [
  { id: "kanban", label: "kanban" },
  { id: "routines", label: "automations" },
  { id: "issues", label: "issues" },
]

export function PageNav() {
  const { nav } = useCopy()
  const open = useStore(page)
  return (
    <div className="rail-nav">
      {NAV.map((item) => (
        <button
          type="button"
          key={item.id}
          className={`rail-nav-row ${open === item.id ? "is-active" : ""}`}
          aria-current={open === item.id ? "page" : undefined}
          onClick={() => page.set(item.id)}
        >
          {nav[item.label]}
        </button>
      ))}
    </div>
  )
}

export function PagesHost({ model, page: current }: { model: AppModel; page: PageId }) {
  // Choosing a task (or opening one from a page) leaves the page.
  useEffect(() => model.selection.subscribe(() => page.set(null)), [model])
  return current === "kanban" ? (
    <KanbanView model={model} />
  ) : current === "routines" ? (
    <RoutinesView model={model} />
  ) : current === "issues" ? (
    <IssuesView model={model} />
  ) : null
}
