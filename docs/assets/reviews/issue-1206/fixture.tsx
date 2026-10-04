/** @jsxImportSource @opentui/react */
import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import { pathIdentity } from "@sma1lboy/rove-daemon/path-identity"
import { RemoteOrchestrator } from "../../../../packages/rove/src/client/remote-orchestrator"
import { createStateCell } from "../../../../packages/rove/src/lib/external-store"
import { KanbanPage } from "../../../../packages/rove/src/tui-react/component/kanban-page"
import { bootPaneHost } from "../../../../packages/rove/src/tui-react/lib/host-boot"
import { type Task, toTaskId } from "../../../../packages/rove/src/types/task"

const projects = ["alpha", "orbit-sdk", "zebra"]
const tasks: Task[] = projects.map((name, i) => ({
  id: toTaskId(`T${i}`),
  title: `Work on ${name}`,
  repo: `c:/repos/${name}/`,
  worktreePath: `c:/repos/${name}/`,
  branch: name,
  kind: "task",
  status: "in_progress",
  createdAt: "2026-10-04T00:00:00Z",
  updatedAt: "2026-10-04T00:00:00Z",
}))
const roots = projects.map((name) => `C:\\repos\\${name}`)
const active = createStateCell<string | null>("T1")
const orchestrator = new RemoteOrchestrator(new RoveDaemonClient(`${process.env.ROVE_HOME_DIR}/unused.sock`))
orchestrator.listTasks = () => tasks
orchestrator.activeTaskSignal = () => active
orchestrator.listIssueRepos = async () => roots
orchestrator.listIssues = async (repo) => {
  const index = roots.findIndex((root) => pathIdentity(root) === pathIdentity(repo))
  if (index < 0) throw new Error(`Unexpected fixture repository: ${repo}`)
  const repoRoot = roots[index]
  if (!repoRoot) throw new Error("Missing fixture root")
  const project = projects[index]
  return {
    repoRoot,
    exists: true,
    nextId: 8,
    skipped: 0,
    issues: [
      { id: 2, title: `${project}: backlog story`, status: "open", created: "2026-10-04", body: "Ready for planning." },
      {
        id: 7,
        title: `${project}: linked story`,
        status: "open",
        created: "2026-10-04",
        body: "The focused task belongs here.",
        taskId: `T${index}`,
      },
    ],
  }
}

await bootPaneHost({
  logContext: "issue-1206-evidence",
  providers: { kv: true, notifications: true },
  setup: () => ({
    root: () => (
      <KanbanPage
        orchestrator={orchestrator}
        focusTask={tasks[1]}
        focused={true}
        onClose={() => process.exit(0)}
        onStartChat={async () => {}}
        onOpenTask={() => {}}
      />
    ),
  }),
})
