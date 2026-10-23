/** @jsxImportSource @opentui/react */
import { afterEach, expect, test } from "bun:test"
import { SidebarTree } from "../../src/tui-react/panes/sidebar/SidebarTree"
import { resetRowStatusForTests } from "../../src/tui-react/workspace/row-status-sync"
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

afterEach(() => {
  resetRowStatusForTests()
  tabsByTask.clear()
})

test("a task with several tabs is one row named by its first conversation — the other tabs live in the tab strip", async () => {
  tabsByTask.set(task.id, {
    tabs: [
      { kind: "engine", id: "tab-1", title: "first", ordinal: 1 },
      { kind: "engine", id: "tab-2", title: "second", ordinal: 2 },
      { kind: "command", id: "tab-3", title: "build shell", ordinal: 3, command: ["bash"] },
    ],
    activeId: "tab-1",
    nextOrdinal: 4,
  })
  const { frame } = await renderComponent(
    <SidebarTree tasks={[task]} selectedId={task.id} onSelect={() => {}} focused={true} width={30} />,
    { width: 30, height: 20 },
  )
  const rendered = await frame()
  expect(rendered).toContain("first")
  for (const title of ["second", "build shell", "Unattributed", "feat/unattributed"]) {
    expect(rendered).not.toContain(title)
  }
})
