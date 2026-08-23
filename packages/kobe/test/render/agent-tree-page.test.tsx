/** @jsxImportSource @opentui/react */

import { expect, test } from "bun:test"
import type { TaskEngineState } from "../../src/client/remote-orchestrator"
import { AgentTreePage } from "../../src/tui-react/component/agent-tree-page"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"
import { act, renderComponent } from "./harness"

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id: toTaskId(id),
    title: id,
    repo: "/repos/rove",
    branch: `feat/${id}`,
    worktreePath: `/wt/${id}`,
    kind: "task",
    status: "in_progress",
    archived: false,
    vendor: "codex",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    ...over,
  }
}

test("renders a Dagre topology, fan-out batch, and engine-normalized activity", async () => {
  const owner = task("Owner session")
  const a = task("API audit", {
    id: toTaskId("agent-a"),
    dispatcher: { taskId: "Owner session", tabId: "tab-1" },
    groupId: "01JAGENTROUND",
  })
  const b = task("UI pass", {
    id: toTaskId("agent-b"),
    dispatcher: { taskId: "Owner session", tabId: "tab-1" },
    groupId: "01JAGENTROUND",
  })
  const engineStates = new Map<string, TaskEngineState>([
    ["agent-a", { state: "running", at: Date.now() }],
    ["agent-b", { state: "turn_complete", at: Date.now() }],
  ])

  const { frame } = await renderComponent(
    <AgentTreePage tasks={[owner, a, b]} engineStates={engineStates} focused={true} onClose={() => {}} />,
    { width: 96, height: 24 },
  )
  const text = await frame()

  expect(text).toContain("AGENT TOPOLOGY")
  expect(text).toContain("Agents 3 · Coordinators 0 · Batches 1")
  expect(text).toContain("BATCH ENTROUND · 2")
  expect(text).toContain("API audit")
  expect(text).toContain("Codex")
  expect(text).toContain("running")
  expect(text).toContain("complete")
})

test("j then enter opens the selected topology node", async () => {
  const owner = task("owner")
  const child = task("child", { dispatcher: { taskId: "owner", tabId: "tab-1" } })
  let opened = ""
  const { mockInput } = await renderComponent(
    <AgentTreePage
      tasks={[owner, child]}
      focused={true}
      onClose={() => {}}
      onOpenTask={(id) => {
        opened = id
      }}
    />,
    { width: 80, height: 20 },
  )

  act(() => mockInput.pressKey("j"))
  act(() => mockInput.pressEnter())
  expect(opened).toBe("child")
})
