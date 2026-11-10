/** @jsxImportSource @opentui/react */
/** Kanban: the daemon issue store as a story board, shipped as a first-party mod. */

import type { PageProps } from "../../tui-react/pages/registry"
import type { BundledPlugin } from "../types"
import { bindHost, host } from "./host"
import { KanbanPage } from "./kanban-page"

function KanbanRailPage(props: PageProps) {
  const startChat = host().issues.useStartChat()
  return (
    <KanbanPage
      orchestrator={props.orchestrator}
      focused={props.focused}
      onClose={props.onClose}
      onStartChat={startChat}
      engineStates={props.engineStates}
      // Opens on the selected task's project, cursor on its linked story card.
      focusTask={props.selectedTask ? { id: props.selectedTask.id, repo: props.selectedTask.repo } : undefined}
      onOpenTask={props.onOpenTask}
    />
  )
}

export const kanbanPlugin: BundledPlugin = {
  id: "kanban",
  name: "Kanban",
  description: "Stories from `rove api issue-*` as a Backlog / In progress / Parked / Done board",
  pages: [
    {
      id: "board",
      title: (h) => h.i18n.t("tasks.nav.kanban"),
      order: 10,
      action: "kanban.open",
      factory: (h) => {
        bindHost(h)
        return KanbanRailPage
      },
    },
  ],
}
