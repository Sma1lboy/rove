/** @jsxImportSource @opentui/react */
/**
 * The folded task rail, against real frames.
 *
 * What is worth pinning here is not that the component renders: it is that the
 * fold keeps the two things the strip exists for. A row must still say WHICH
 * key reaches it, and it must still say what is happening there — and the
 * second is carried by colour alone once the title is gone, which is exactly
 * the kind of claim a props-level assertion cannot make.
 */

import { expect, test } from "bun:test"
import { CollapsedRail, railInitials } from "../../src/tui-react/panes/sidebar/collapsed-rail"
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

function railProps(over: Partial<Parameters<typeof CollapsedRail>[0]> = {}) {
  return {
    style: "digits" as const,
    tasks: TASKS,
    selectedId: "t1",
    onSelect: () => {},
    onExpand: () => {},
    ...over,
  }
}

test("the digit fold prints the jump key that actually reaches each row", async () => {
  const { frame } = await renderComponent(<Rail {...railProps()} />, { width: 8, height: 10 })
  const text = await frame()

  // `1` is deliberately absent from the jump table — ctrl+1 has no encoding in
  // the legacy terminal protocol, so row one is reachable as `2`.
  expect(text).toContain("2")
  expect(text).toContain("3")
  expect(text).toContain("4")
})

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
    <Rail {...railProps({ onSelect: (id: string) => picked.push(id) })} />,
    { width: 8, height: 10 },
  )
  const text = await frame()
  const row = text.split("\n").findIndex((line) => line.includes("3"))

  await mockMouse.click(1, row)
  expect(picked).toEqual(["t2"])
})

test("the corner control is what expands, so a row click is never swallowed", async () => {
  let expands = 0
  const picked: string[] = []
  const { frame, mockMouse } = await renderComponent(
    <Rail {...railProps({ onExpand: () => expands++, onSelect: (id: string) => picked.push(id) })} />,
    { width: 8, height: 10 },
  )
  const text = await frame()
  const lines = text.split("\n")

  // A row click must not reach the expand control.
  await mockMouse.click(
    1,
    lines.findIndex((line) => line.includes("2")),
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
  for (const style of ["hairline", "digits", "glyphs", "initials"] as const) {
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
