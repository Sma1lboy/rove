/** @jsxImportSource @opentui/react */

import { expect, test } from "bun:test"
import type { ReactNode } from "react"
import type { FocusContextValue } from "../../src/tui-react/context/focus"
import { type HostPageDeps, renderContentPage, useHostPagesState } from "../../src/tui-react/workspace/host-pages"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"
import { renderComponent } from "./harness"

const NOOP = (): void => {}

function ownerTask(): Task {
  return {
    id: toTaskId("owner"),
    title: "Release owner",
    repo: "/repos/rove",
    branch: "feat/release",
    worktreePath: "/wt/release",
    kind: "task",
    status: "in_progress",
    archived: false,
    vendor: "codex",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
  }
}

function deps(task: Task, opened: string[]): HostPageDeps {
  return {
    orchestrator: null,
    tasks: [task],
    selectedTask: task,
    worktreesOpen: false,
    agentsOpen: true,
    automationsOpen: false,
    workItemsOpen: false,
    kanbanOpen: false,
    updateOpen: false,
    closeWorktrees: NOOP,
    closeAutomations: NOOP,
    closeWorkItems: NOOP,
    closeKanban: NOOP,
    closeAgents: () => opened.push("closed"),
    closeUpdate: NOOP,
    activateTask: (taskId) => opened.push(taskId),
    contentFocused: true,
    startIssueChat: async () => {},
    engineStates: new Map(),
  }
}

test("host page routing renders Agent Tree and opens its selected task", async () => {
  const opened: string[] = []
  const view = renderContentPage(deps(ownerTask(), opened))
  const { frame, mockInput } = await renderComponent(view, { width: 84, height: 20 })

  expect(await frame()).toContain("AGENT TREE")
  mockInput.pressEnter()
  expect(opened).toEqual(["closed", "owner"])
})

function NavProbe(props: { focus: FocusContextValue }): ReactNode {
  const pages = useHostPagesState(props.focus)
  return (
    <box onMouseUp={() => pages.goToNav("agents")}>
      <text>{pages.agentsOpen ? "agents-open" : "open-agents"}</text>
    </box>
  )
}

test("host page state moves focus into the Agent Tree content pane", async () => {
  const focused: string[] = []
  const focus: FocusContextValue = {
    focused: "sidebar",
    is: (pane) => pane === "sidebar",
    setFocused: (pane) => {
      focused.push(pane)
    },
    cycle: NOOP,
  }
  const { frame, mockMouse } = await renderComponent(<NavProbe focus={focus} />, { width: 30, height: 4 })

  await mockMouse.click(2, 0)
  expect(await frame()).toContain("agents-open")
  expect(focused).toEqual(["workspace"])
})
