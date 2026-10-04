/** @jsxImportSource @opentui/react */
import { expect, test } from "bun:test"
import { SidebarTree } from "../../src/tui-react/panes/sidebar/SidebarTree"
import { tabsByTask } from "../../src/tui-react/workspace/terminal-tabs-shared"
import { type Task, toTaskId } from "../../src/types/task"
import { renderComponent } from "./harness"

const task: Task = {
  id: toTaskId("unattributed"),
  title: "Unattributed",
  repo: "/repos/rove",
  branch: "feat/unattributed",
  worktreePath: "/wt/unattributed",
  kind: "task",
  vendor: "claude",
  status: "in_progress",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
}

for (const selectedTabId of ["tab-1", "tab-2"]) {
  test(`task-only running does not light selected ${selectedTabId} or its sibling`, async () => {
    tabsByTask.set(task.id, {
      tabs: [
        { kind: "engine", id: "tab-1", title: "first", ordinal: 1 },
        { kind: "engine", id: "tab-2", title: "second", ordinal: 2 },
      ],
      activeId: selectedTabId,
      nextOrdinal: 3,
    })
    const { frame } = await renderComponent(
      <SidebarTree
        tasks={[task]}
        selectedId={task.id}
        selectedTabId={selectedTabId}
        onSelect={() => {}}
        focused={true}
        width={30}
        engineState={new Map([[task.id, { state: "running", at: Date.now() }]])}
        engineTabState={new Map()}
      />,
      { width: 30, height: 20 },
    )
    const rendered = await frame()
    expect(rendered).toContain("○ first")
    expect(rendered).toContain("○ second")
  })
}
