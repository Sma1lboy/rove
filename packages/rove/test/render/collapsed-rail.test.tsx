/** @jsxImportSource @opentui/react */
/**
 * The folded task rail, against real frames.
 *
 * What is worth pinning here is not that the component renders: it is that the
 * fold keeps what the strip exists for: a row must still say what is happening
 * there, carried by colour alone once the title is gone — exactly the kind of
 * claim a props-level assertion cannot make.
 */

import { expect, test } from "bun:test"
import { CollapsedRail } from "../../src/tui-react/panes/sidebar/collapsed-rail"
import { buildSidebarGroups } from "../../src/tui/panes/sidebar/project-groups"
import type { Task } from "../../src/types/task"
import { renderComponent } from "./harness"

/**
 * The rail is stretched to the pane's full height in the workspace, and the
 * expand control is anchored to the bottom of that. Rendered bare it collapses
 * to content height and the control lands on the last row — so every case
 * mounts it in a box with a height, which is the shape it actually ships in.
 */
function Rail(props: Parameters<typeof CollapsedRail>[0]) {
  return (
    <box height={10} flexDirection="row">
      <CollapsedRail {...props} />
    </box>
  )
}

function task(id: string, title: string): Task {
  return {
    id,
    title,
    repo: "/repo",
    branch: title.split(" ")[0] ?? "",
    worktreePath: "/repo",
    status: "backlog",
    kind: "task",
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
  } as Task
}

const TASKS = [task("t1", "Visual Fixture"), task("t2", "fix completions"), task("t3", "sidebar collapse")]

/**
 * The rail renders the sections the EXPANDED tree renders — it is handed
 * `SidebarGroup[]`, never a task list of its own. Going through the shared
 * builder here is the point: a divider asserted below is a divider the tree
 * would draw too. An empty tab map means "never mounted", which is what keeps
 * these fixtures out of the closed-down-project hide rule.
 */
function groupsOf(tasks: readonly Task[]) {
  return buildSidebarGroups({ tasks, tabsByTask: new Map() })
}

function railProps(over: Partial<Parameters<typeof CollapsedRail>[0]> = {}) {
  return {
    style: "glyphs" as const,
    groups: groupsOf(TASKS),
    selectedId: "t1",
    onSelect: () => {},
    onExpand: () => {},
    ...over,
  }
}

test("clicking a row selects that task, not whichever row the strip starts at", async () => {
  const picked: string[] = []
  const { frame, mockMouse } = await renderComponent(
    <Rail {...railProps({ style: "initials", onSelect: (id: string) => picked.push(id) })} />,
    { width: 10, height: 10 },
  )
  const text = await frame()
  const row = text.split("\n").findIndex((line) => line.includes("fc"))

  await mockMouse.click(1, row)
  expect(picked).toEqual(["t2"])
})

test("the initials fold keeps two letters of the title beside the state", async () => {
  const { frame } = await renderComponent(<Rail {...railProps({ style: "initials" })} />, {
    width: 10,
    height: 10,
  })
  const text = await frame()

  expect(text).toContain("VF")
  expect(text).toContain("fc")
})

/**
 * The fold keeps PROJECT boundaries. Without them the strip is one column of
 * glyphs with no way to tell which repo a row belongs to — and the grouping is
 * most of what makes a dozen rows legible at a glance.
 *
 * Asserted on frames, not on props, because the divider is a rendered row: a
 * props-level check would pass on a boundary the reader cannot see.
 */
function repoTask(id: string, title: string, repo: string): Task {
  return { ...task(id, title), repo } as Task
}

test("project headings fit every fold, including wide project initials", async () => {
  for (const style of ["hairline", "glyphs", "initials"] as const) {
    const tasks = [repoTask("a", "one", "/work/rove"), repoTask("b", "two", "/work/中文")]
    const { frame } = await renderComponent(<Rail {...railProps({ style, groups: groupsOf(tasks) })} />, {
      width: 12,
      height: 10,
    })
    const lines = (await frame()).split("\n")
    expect(lines[0]).toContain("r─")
    expect(lines[2]).toContain("中")
    expect(lines[3]?.trim().length).toBeGreaterThan(0)
  }
})

/**
 * A task with several chats folds to one numbered cell per tab, so the second
 * chat's turn stays visible folded, and the digit is the `ctrl+<N>` it answers
 * to. A task with no known tabs keeps its single glyph.
 */
test("a task with tabs folds to one numbered cell per tab", async () => {
  const tab = (id: string, active = false) => ({ id, label: id, active, engine: true, liveVendor: null })
  const picked: string[] = []
  const { frame, mockMouse } = await renderComponent(
    <Rail
      {...railProps({
        tabsByTask: new Map([["t1", [tab("a", true), tab("b"), tab("c")]]]),
        onSelectTab: (taskId: string, tabId: string) => picked.push(`${taskId}:${tabId}`),
      })}
    />,
    { width: 10, height: 10 },
  )
  const lines = (await frame()).split("\n")
  expect(lines.slice(1, 4).map((line) => line.trim())).toEqual(["▌1", "2", "3"])

  await mockMouse.click(1, 3)
  expect(picked).toEqual(["t1:c"])
})
