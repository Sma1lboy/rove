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
  task("parent", { branch: "feat/parent" }),
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
  expect(lineWith(open, "feat/parent")).toContain("▾")

  // Folding is a click on the parent's fold glyph.
  const parentLine = lineWith(open, "feat/parent")
  await mockMouse.click(parentLine.indexOf("▾"), open.split("\n").indexOf(parentLine), 0)
  await settle(80)

  const folded = await frame()
  expect(folded).not.toContain("check types")
  expect(folded).not.toContain("port tree builder")
  const summary = lineWith(folded, "feat/parent")
  expect(summary).toContain("▸ 2")
  // A question outranks a sibling that is still working.
  expect(summary).toContain(DEFAULT_GLYPHS.needsInput)
})
