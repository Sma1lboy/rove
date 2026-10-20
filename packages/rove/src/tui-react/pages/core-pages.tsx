/** @jsxImportSource @opentui/react */
/** The pages the host itself ships, registered as the `core` source. */

import { t } from "../../tui/i18n"
import { AutomationsPage } from "../component/automations-page"
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

export const CORE_PAGES: readonly PageEntry[] = [
  {
    id: "automations",
    title: () => t("tasks.nav.automations"),
    order: 20,
    action: "automations.open",
    component: RoutinesRailPage,
  },
]

export function registerCorePages(): void {
  setPageSource("core", CORE_PAGES)
}
