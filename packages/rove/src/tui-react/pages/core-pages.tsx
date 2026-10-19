/** @jsxImportSource @opentui/react */
/** The pages the host itself ships, registered as the `core` source. */

import { t } from "../../tui/i18n"
import { AutomationsPage } from "../component/automations-page"
import { KanbanPage } from "../component/kanban-page"
import { WorkItemsPage } from "../component/work-items-page"
import { type PageEntry, type PageProps, setPageSource } from "./registry"
import { usePageServices } from "./services"

function RoutinesRailPage(props: PageProps) {
  return (
    <AutomationsPage
      orchestrator={props.orchestrator}
      focused={props.focused}
      {...(props.selectedTask ? { focusRepo: props.selectedTask.repo } : {})}
      onClose={props.onClose}
      onOpenTask={props.onOpenTask}
    />
  )
}

function KanbanRailPage(props: PageProps) {
  const services = usePageServices()
  return (
    <KanbanPage
      orchestrator={props.orchestrator}
      focused={props.focused}
      onClose={props.onClose}
      onStartChat={services.startIssueChat}
      engineStates={props.engineStates}
      // Opens on the selected task's project, cursor on its linked story card.
      focusTask={props.selectedTask ? { id: props.selectedTask.id, repo: props.selectedTask.repo } : undefined}
      onOpenTask={props.onOpenTask}
    />
  )
}

function IssuesRailPage(props: PageProps) {
  return (
    <WorkItemsPage
      orchestrator={props.orchestrator}
      focused={props.focused}
      onClose={props.onClose}
      {...(props.selectedTask ? { focusRepo: props.selectedTask.repo } : {})}
      onOpenTask={props.onOpenTask}
    />
  )
}

export const CORE_PAGES: readonly PageEntry[] = [
  {
    id: "kanban",
    title: () => t("tasks.nav.kanban"),
    order: 10,
    action: "kanban.open",
    component: KanbanRailPage,
  },
  {
    id: "automations",
    title: () => t("tasks.nav.automations"),
    order: 20,
    action: "automations.open",
    component: RoutinesRailPage,
  },
  {
    id: "issues",
    title: () => t("tasks.nav.issues"),
    order: 30,
    action: "workItems.open",
    component: IssuesRailPage,
  },
]

export function registerCorePages(): void {
  setPageSource("core", CORE_PAGES)
}
