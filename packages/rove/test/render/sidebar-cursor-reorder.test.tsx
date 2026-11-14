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
  /** One input per act, then a render pass, so the next key sees the committed cursor. */
  const input = async (fire: () => unknown): Promise<void> => {
    act(() => {
      fire()
    })
    await handle.frame()
  }
  return {
    ...handle,
    input,
    chosen,
    updateTasks: (tasks: Task[]) => act(() => updateTasks(tasks)),
    select: (id: string) => act(() => select(id)),
  }
}

test("Move to top keeps the cursor on the project's main row", async () => {
  const { frame, mockMouse, mockInput, input, chosen } = await mount()
  const row = (await frame()).split("\n").findIndex((line) => line.includes("charlie"))
  expect(row).toBeGreaterThan(-1)
  await act(async () => {
    await mockMouse.click(2, row, 2)
  })
  expect(await frame()).toContain("Move to top")
  await input(() => mockInput.typeText("j"))
  await input(() => mockInput.pressEnter())
  const reordered = await frame()
  expect(reordered.indexOf("charlie")).toBeLessThan(reordered.indexOf("alpha"))
  await input(() => mockInput.pressEnter())
  expect(chosen).toEqual(["charlie"])
})

test("j/k walking survives a poll rebuild, while an external selection still follows", async () => {
  const { mockInput, input, chosen, select } = await mount()
  await input(() => mockInput.typeText("j"))
  // Real time on purpose: the poll is a module-level setInterval with no test hook, and bun's fake
  // timers break opentui's render flush, so the only way to get a tick is to wait one out.
  await new Promise((resolve) => setTimeout(resolve, MAIN_BRANCH_POLL_MS + 100))
  await input(() => mockInput.pressEnter())
  await input(() => mockInput.typeText("k"))
  await input(() => mockInput.pressEnter())
  await select("charlie")
  await input(() => mockInput.pressEnter())
  expect(chosen).toEqual(["bravo", "alpha", "charlie"])
})

test("a remote reorder follows the cursor row and removing it clamps the cursor", async () => {
  const { mockInput, input, chosen, updateTasks } = await mount()
  await input(() => mockInput.typeText("j"))
  await input(() => mockInput.typeText("j"))
  await updateTasks([...projects].reverse())
  await input(() => mockInput.pressEnter())
  await updateTasks(projects)
  await updateTasks(projects.slice(0, 2))
  await input(() => mockInput.pressEnter())
  expect(chosen).toEqual(["charlie", "bravo"])
})
