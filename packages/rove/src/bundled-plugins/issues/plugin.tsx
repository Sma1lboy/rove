/** @jsxImportSource @opentui/react */
/** Issues: a project's open GitHub issues, startable as tasks, shipped as a built-in plugin. */

import type { PageProps } from "../../tui-react/pages/registry"
import type { BundledPlugin } from "../types"
import { bindHost } from "./host"
import { WorkItemsPage } from "./work-items-page"

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

export const issuesPlugin: BundledPlugin = {
  id: "issues",
  name: "Issues",
  description: "Open GitHub issues for the selected project, via `gh`",
  pages: [
    {
      id: "github",
      title: (h) => h.i18n.t("tasks.nav.issues"),
      order: 30,
      action: "workItems.open",
      factory: (h) => {
        bindHost(h)
        return IssuesRailPage
      },
    },
  ],
}
