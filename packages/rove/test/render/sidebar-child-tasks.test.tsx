/** @jsxImportSource @opentui/react */
/**
 * Child tasks in the real tree: nested under their parent with a marker for
 * where they run, and folded away behind a count and the most urgent state.
 */

import { afterEach, expect, test } from "bun:test"
import { SidebarTree } from "../../src/tui-react/panes/sidebar/SidebarTree"
import { resetRowStatusForTests } from "../../src/tui-react/workspace/row-status-sync"
import { tabsByTask } from "../../src/tui-react/workspace/terminal-tabs-shared"
import { DEFAULT_GLYPHS } from "../../src/tui/lib/glyphs"
import { type Task, toTaskId } from "../../src/types/task"
import { renderComponent, settle } from "./harness"

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id: toTaskId(id),
    title: id,
    repo: "/repos/rove",
    branch: `feat/${id}`,
    worktreePath: `/wt/${id}`,
    kind: "task",
    status: "in_progress",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  }
}

const PARENT = toTaskId("parent")
const TASKS = [
  task("parent", { branch: "parent" }),
  task("shared", { title: "check types", parentTaskId: PARENT, sharesWorkspaceOf: PARENT }),
  task("own", { title: "port tree builder", parentTaskId: PARENT }),
]
const NOW = Date.now()

afterEach(() => {
  resetRowStatusForTests()
  tabsByTask.clear()
})

function lineWith(frame: string, needle: string): string {
  return frame.split("\n").find((line) => line.includes(needle)) ?? ""
}

test("a collapsed parent shows its child count and the most urgent child's state; children wear their marker", async () => {
  tabsByTask.clear()
  resetRowStatusForTests({
    shared: { task: { kind: "needs-input", since: NOW, state: "permission_needed" }, tabs: {} },
    own: { task: { kind: "running", since: NOW, state: "running" }, tabs: {} },
  })
  const { frame, mockMouse } = await renderComponent(
    <SidebarTree tasks={TASKS} selectedId="parent" onSelect={() => {}} focused={true} width={40} />,
    { width: 40, height: 16 },
  )
  await settle(80)

  const open = await frame()
  expect(lineWith(open, "check types")).toContain("⑂")
  expect(lineWith(open, "port tree builder")).toContain("⎇")
  expect(lineWith(open, "parent")).toContain("▾")

  // Folding is a click on the parent's fold glyph.
  const parentLine = lineWith(open, "parent")
  await mockMouse.click(parentLine.indexOf("▾"), open.split("\n").indexOf(parentLine), 0)
  await settle(80)

  const folded = await frame()
  expect(folded).not.toContain("check types")
  expect(folded).not.toContain("port tree builder")
  const summary = lineWith(folded, "parent")
  expect(summary).toContain("▸ 2")
  // A question outranks a sibling that is still working.
  expect(summary).toContain(DEFAULT_GLYPHS.needsInput)
})

test("a child that has children of its own keeps its marker and fold glyph in separate cells and truncates the title before them", async () => {
  tabsByTask.clear()
  resetRowStatusForTests()
  const OWN = toTaskId("own")
  const tasks = [
    task("parent", { branch: "feat/parent" }),
    task("own", { title: "A very long child title that cannot fit", parentTaskId: PARENT }),
    task("grand", { title: "grandchild", parentTaskId: OWN }),
  ]
  const { frame } = await renderComponent(
    <SidebarTree tasks={tasks} selectedId="parent" onSelect={() => {}} focused={true} width={30} />,
    { width: 30, height: 16 },
  )
  await settle(80)
  const line = lineWith(await frame(), "A very long")
  // The marker is not glued to the fold glyph: a wide-drawn ⎇ would smear into it.
  expect(line).toMatch(/…\s+⎇ ▾/)
})

test("the task-colour bar stays in one column while child titles indent past it", async () => {
  tabsByTask.clear()
  resetRowStatusForTests()
  const { frame } = await renderComponent(
    <SidebarTree tasks={TASKS} selectedId="parent" onSelect={() => {}} focused={true} width={40} />,
    { width: 40, height: 16 },
  )
  await settle(80)

  const open = await frame()
  const parent = lineWith(open, "parent")
  const child = lineWith(open, "check types")
  expect(child.indexOf("▎")).toBe(parent.indexOf("▎"))
  expect(child.indexOf("check types")).toBeGreaterThan(parent.indexOf("parent"))
})
