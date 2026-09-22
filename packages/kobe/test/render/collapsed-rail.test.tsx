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
import { CollapsedRail, railInitials } from "../../src/tui-react/panes/sidebar/collapsed-rail"
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

test("a quiet row still carries its state, as colour, with no title left to read", async () => {
  const { spans } = await renderComponent(<Rail {...railProps()} />, { width: 8, height: 10 })
  const painted = (await spans()).lines
    .flatMap((line) => line.spans)
    .filter((span) => span.text.trim().length > 0 && span.fg !== undefined)

  expect(painted.length).toBeGreaterThan(0)
})

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

test("the corner control is what expands, so a row click is never swallowed", async () => {
  let expands = 0
  const picked: string[] = []
  const { frame, mockMouse } = await renderComponent(
    <Rail
      {...railProps({ style: "initials", onExpand: () => expands++, onSelect: (id: string) => picked.push(id) })}
    />,
    { width: 10, height: 10 },
  )
  const text = await frame()
  const lines = text.split("\n")

  // A row click must not reach the expand control.
  await mockMouse.click(
    1,
    lines.findIndex((line) => line.includes("VF")),
  )
  expect(expands).toBe(0)
  expect(picked).toEqual(["t1"])
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

test("every fold is narrower than the rail it replaces", async () => {
  for (const style of ["hairline", "glyphs", "initials"] as const) {
    const { frame } = await renderComponent(<Rail {...railProps({ style })} />, {
      width: 12,
      height: 10,
    })
    const text = await frame()
    const widest = Math.max(...text.split("\n").map((line) => line.trimEnd().length))
    expect(widest).toBeLessThanOrEqual(8)
  }
})

test("railInitials falls back rather than printing an empty cell", () => {
  expect(railInitials("fix completions")).toBe("fc")
  expect(railInitials("sidebar")).toBe("si")
  expect(railInitials("   ")).toBe("··")
  // Separators count as word breaks: a branch-shaped title has no spaces.
  expect(railInitials("fix/rail-width")).toBe("fr")
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

test("a project boundary draws a divider, and rows inside one project do not", async () => {
  const sameProject = [repoTask("a1", "one", "/work/api"), repoTask("a2", "two", "/work/api")]
  const { frame: sameFrame } = await renderComponent(<Rail {...railProps({ groups: groupsOf(sameProject) })} />, {
    width: 8,
    height: 10,
  })
  expect((await sameFrame()).match(/a──/g)).toHaveLength(1)

  const twoProjects = [repoTask("a1", "one", "/work/api"), repoTask("b1", "three", "/work/web")]
  const { frame: splitFrame } = await renderComponent(<Rail {...railProps({ groups: groupsOf(twoProjects) })} />, {
    width: 8,
    height: 10,
  })
  expect(await splitFrame()).toContain("a──")
  expect(await splitFrame()).toContain("w──")
})

test("scratch tasks are one section of their own, above the projects", async () => {
  const scratch = { ...repoTask("s1", "scratch", "/tmp/x"), kind: "dir", scratch: true } as Task
  const tasks = [scratch, repoTask("a1", "one", "/work/api")]
  const { frame } = await renderComponent(<Rail {...railProps({ groups: groupsOf(tasks), selectedId: "s1" })} />, {
    width: 8,
    height: 10,
  })
  // A scratch row and a project row are different sections even though the
  // scratch task carries a repo path of its own.
  expect(await frame()).toContain("s──")
  expect(await frame()).toContain("a──")
})

test("the selected row carries the same marker the expanded rows use", async () => {
  const { frame } = await renderComponent(<Rail {...railProps()} />, { width: 8, height: 10 })
  // `▌` is what `resolveRowSelectionChrome` hands every other row surface; a
  // background alone disappears entirely under a transparent theme.
  expect(await frame()).toContain("▌")
})

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
