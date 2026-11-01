/** @jsxImportSource @opentui/react */
/** The pages the host itself ships, registered as the `core` source. */

import { t } from "../../tui/i18n"
import { AutomationsPage } from "../component/automations-page"
import { SearchPage } from "../component/search-page"
import { type PageEntry, type PageProps, setPageSource } from "./registry"

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

function SearchRailPage(props: PageProps) {
  return (
    <SearchPage
      orchestrator={props.orchestrator}
      focused={props.focused}
      onClose={props.onClose}
      onOpenTask={props.onOpenTask}
    />
  )
}

export const CORE_PAGES: readonly PageEntry[] = [
  {
    id: "automations",
    title: () => t("tasks.nav.automations"),
    order: 20,
    action: "automations.open",
    component: RoutinesRailPage,
  },
  // After Kanban, Routines and Issues (10/20/30); no `action`, so no chord: the rail row is the way in.
  { id: "search", title: () => t("search.title"), order: 40, component: SearchRailPage },
]

export function registerCorePages(): void {
  setPageSource("core", CORE_PAGES)
}
