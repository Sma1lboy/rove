/** @jsxImportSource @opentui/react */
import { expect, test } from "bun:test"
import { useState } from "react"
import { SidebarTree } from "../../src/tui-react/panes/sidebar/SidebarTree"
import { tabsByTask } from "../../src/tui-react/workspace/terminal-tabs-shared"
import { MAIN_BRANCH_POLL_MS } from "../../src/tui/panes/sidebar/view-core"
import { type Task, toTaskId } from "../../src/types/task"
import { act, renderComponent } from "./harness"

const projects: Task[] = ["alpha", "bravo", "charlie"].map((id) => ({
  id: toTaskId(id),
  title: id,
  repo: `/repos/${id}`,
  branch: "",
  worktreePath: `/repos/${id}`,
  kind: "main",
  status: "in_progress",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
}))
const settle = () => new Promise((resolve) => setTimeout(resolve, 80))

async function mount() {
  tabsByTask.clear()
  const chosen: string[] = []
  let updateTasks: (tasks: Task[]) => void = () => {}
  let select: (id: string) => void = () => {}
  function Host() {
    const [tasks, setTasks] = useState(projects)
    const [selectedId, setSelectedId] = useState("alpha")
    updateTasks = setTasks
    select = setSelectedId
    return (
      <SidebarTree
        tasks={tasks}
        selectedId={selectedId}
        onSelect={(id) => chosen.push(id)}
        onMoveToTopRequest={(id) =>
          setTasks((rows) => [...rows.filter((row) => row.id === id), ...rows.filter((row) => row.id !== id)])
        }
        focused={true}
        width={40}
      />
    )
  }
  const handle = await renderComponent(<Host />, { width: 40, height: 24 })
  await settle()
  return {
    ...handle,
    chosen,
    updateTasks: (tasks: Task[]) => act(() => updateTasks(tasks)),
    select: (id: string) => act(() => select(id)),
  }
}

test("Move to top keeps the cursor on the project's main row", async () => {
  const { frame, mockMouse, mockInput, chosen } = await mount()
  const row = (await frame()).split("\n").findIndex((line) => line.includes("charlie"))
  expect(row).toBeGreaterThan(-1)
  await mockMouse.click(2, row, 2)
  await settle()
  expect(await frame()).toContain("Move to top")
  mockInput.typeText("j")
  await settle()
  mockInput.pressEnter()
  await settle()
  const reordered = await frame()
  expect(reordered.indexOf("charlie")).toBeLessThan(reordered.indexOf("alpha"))
  mockInput.pressEnter()
  await settle()
  expect(chosen).toEqual(["charlie"])
})

test("j/k walking survives a poll rebuild, while an external selection still follows", async () => {
  const { mockInput, chosen, select } = await mount()
  mockInput.typeText("j")
  await settle()
  await new Promise((resolve) => setTimeout(resolve, MAIN_BRANCH_POLL_MS + 100))
  mockInput.pressEnter()
  await settle()
  mockInput.typeText("k")
  await settle()
  mockInput.pressEnter()
  await settle()
  await select("charlie")
  await settle()
  mockInput.pressEnter()
  await settle()
  expect(chosen).toEqual(["bravo", "alpha", "charlie"])
})

test("a remote reorder follows the cursor row and removing it clamps the cursor", async () => {
  const { mockInput, chosen, updateTasks } = await mount()
  mockInput.typeText("jj")
  await settle()
  await updateTasks([...projects].reverse())
  await settle()
  mockInput.pressEnter()
  await settle()
  await updateTasks(projects)
  await settle()
  await updateTasks(projects.slice(0, 2))
  await settle()
  mockInput.pressEnter()
  await settle()
  expect(chosen).toEqual(["charlie", "bravo"])
})
