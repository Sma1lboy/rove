/** @jsxImportSource @opentui/react */
/**
 * The sidebar's routine fold, against real captured frames.
 *
 * Asserted on the FRAME, not on `buildTreeRows`' output: the thing that has to
 * be true is that a routine session's row is not on screen at rest, and a pure
 * function returning the right array proves nothing about what the pane paints.
 *
 * The keypress cases exist for the same reason `sidebar-tree.test.tsx` has
 * them: a fold whose ⏎ does nothing renders identically to one that is simply
 * closed, and a frame-only test would stay green through a dead toggle.
 */
import { expect, test } from "bun:test"
import { SidebarTree } from "../../src/tui-react/panes/sidebar/SidebarTree"
import { tabsByTask } from "../../src/tui-react/workspace/terminal-tabs-shared"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"
import { renderComponent } from "./harness"

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

const MAIN = task("m", { kind: "main", branch: "", worktreePath: "/repos/rove" })
const MINE = task("mine-task")
const ROUTINES = [
  task("nightly-audit", { routine: { automationId: "auto-1" } }),
  task("dep-check", { routine: { automationId: "auto-2" } }),
  task("ci-trend", { routine: { automationId: "auto-3" } }),
]
const SETTLE = 80

function tree(over: Partial<Parameters<typeof SidebarTree>[0]> = {}) {
  return (
    <SidebarTree
      tasks={[MAIN, MINE, ...ROUTINES]}
      selectedId="mine-task"
      selectedTabId={null}
      onSelect={() => {}}
      focused={true}
      width={34}
      {...over}
    />
  )
}

test("routine sessions rest behind a count row instead of loose rows", async () => {
  tabsByTask.clear()
  const { frame } = await renderComponent(tree(), { width: 34, height: 20 })
  await new Promise((r) => setTimeout(r, SETTLE))
  const painted = await frame()

  // The task the user opened is on screen…
  expect(painted).toContain("mine-task")
  // …and the three the SCHEDULE opened are not — that is the whole point:
  // 7 daily routines would otherwise be 49 rows a week of background noise.
  expect(painted).not.toContain("nightly-audit")
  expect(painted).not.toContain("dep-check")
  expect(painted).not.toContain("ci-trend")
  // One row stands in for them, and it says how many there are.
  expect(painted).toContain("3 routine sessions")
})

test("enter on the count row reveals the sessions, and closes them again", async () => {
  tabsByTask.clear()
  const { frame, mockInput } = await renderComponent(tree(), { width: 34, height: 20 })
  await new Promise((r) => setTimeout(r, SETTLE))

  // Cursor starts on the selected `mine-task`; j steps onto the count row,
  // which sorts after every task the user opened.
  mockInput.typeText("j")
  await new Promise((r) => setTimeout(r, SETTLE))
  mockInput.pressEnter()
  await new Promise((r) => setTimeout(r, SETTLE))

  const opened = await frame()
  expect(opened).toContain("nightly-audit")
  expect(opened).toContain("ci-trend")

  // Toggling shut restores the resting state — the fold is not one-way.
  mockInput.pressEnter()
  await new Promise((r) => setTimeout(r, SETTLE))
  expect(await frame()).not.toContain("nightly-audit")
})

test("opening the fold does not activate a task", async () => {
  tabsByTask.clear()
  const activated: string[] = []
  const selected: string[] = []
  const { mockInput } = await renderComponent(
    tree({ onActivate: (id) => activated.push(id), onSelect: (id) => selected.push(id) }),
    { width: 34, height: 20 },
  )
  await new Promise((r) => setTimeout(r, SETTLE))

  mockInput.typeText("j")
  await new Promise((r) => setTimeout(r, SETTLE))
  mockInput.pressEnter()
  await new Promise((r) => setTimeout(r, SETTLE))

  // The row names no task: passing its sentinel id to onSelect/onActivate
  // would land the workspace on nothing at all.
  expect(activated).toEqual([])
  expect(selected).toEqual([])
})

test("a folded routine session is still findable by search", async () => {
  tabsByTask.clear()
  // Hiding a row at rest must not make it unreachable — search is how you get
  // to one without opening the fold first. Driven through the real `/` chord,
  // since the query is the sidebar's own state, not a prop.
  const { frame, mockInput } = await renderComponent(tree(), { width: 34, height: 20 })
  await new Promise((r) => setTimeout(r, SETTLE))
  mockInput.typeText("/")
  await new Promise((r) => setTimeout(r, SETTLE))
  mockInput.typeText("nightly")
  await new Promise((r) => setTimeout(r, SETTLE))
  const painted = await frame()

  expect(painted).toContain("nightly-audit")
  // The fold toggle itself does not survive a search: its rows are shown
  // directly, so there would be nothing left underneath it.
  expect(painted).not.toContain("routine sessions")
})

test("a project with no routines shows no count row", async () => {
  tabsByTask.clear()
  const { frame } = await renderComponent(tree({ tasks: [MAIN, MINE] }), { width: 34, height: 20 })
  await new Promise((r) => setTimeout(r, SETTLE))

  expect(await frame()).not.toContain("routine sessions")
})
