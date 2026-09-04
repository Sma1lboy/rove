/** @jsxImportSource @opentui/react */
/**
 * Set-status picker (`component/status-picker-dialog.tsx`) — REAL keypresses
 * against the mounted view.
 *
 * The load-bearing part is the CURSOR-to-VALUE mapping, and it is the kind
 * that fails silently: the list is rendered from `TASK_STATUSES` while the
 * commit indexes back into it, so an off-by-one produces a dialog that looks
 * completely correct and writes the neighbouring status. Every test here
 * therefore asserts the value that came OUT, not the frame that went in.
 */

import { describe, expect, test } from "bun:test"
import { StatusPickerDialogView } from "../../src/tui-react/component/status-picker-dialog"
import type { TaskStatus } from "../../src/types/task"
import { type RenderHandle, act, renderComponent } from "./harness"

function mount(current: TaskStatus = "in_progress"): Promise<RenderHandle> & { picked: TaskStatus[] } {
  const picked: TaskStatus[] = []
  const p = renderComponent(
    <StatusPickerDialogView current={current} onSubmit={(v) => picked.push(v)} onCancel={() => {}} />,
    { providers: { dialog: true } },
  ) as Promise<RenderHandle> & { picked: TaskStatus[] }
  p.picked = picked
  return p
}

describe("StatusPickerDialogView", () => {
  test("lists all six statuses and marks the current one", async () => {
    const p = mount("in_progress")
    const { frame } = await p
    const first = await frame()
    expect(first).toContain("Set status")
    for (const label of ["Backlog", "In progress", "In review", "Done", "Canceled", "Error"]) {
      expect(first).toContain(label)
    }
    expect(first).toContain("current")
  })

  test("opens ON the task's current status — enter alone re-picks it, never a neighbour", async () => {
    const p = mount("done")
    const { frame, mockInput } = await p
    await frame()
    act(() => mockInput.pressEnter())
    await frame()
    expect(p.picked).toEqual(["done"])
  })

  test("down then enter commits the NEXT status in the union's order", async () => {
    const p = mount("in_review")
    const { frame, mockInput } = await p
    await frame()
    act(() => mockInput.pressArrow("down"))
    act(() => mockInput.pressEnter())
    await frame()
    expect(p.picked).toEqual(["done"])
  })

  test("up walks back toward backlog and clamps there rather than wrapping", async () => {
    const p = mount("in_progress")
    const { frame, mockInput } = await p
    await frame()
    act(() => mockInput.pressArrow("up"))
    act(() => mockInput.pressArrow("up"))
    act(() => mockInput.pressArrow("up"))
    act(() => mockInput.pressEnter())
    await frame()
    expect(p.picked).toEqual(["backlog"])
  })

  test("down clamps at the last status instead of falling off the end", async () => {
    const p = mount("error")
    const { frame, mockInput } = await p
    await frame()
    act(() => mockInput.pressArrow("down"))
    act(() => mockInput.pressArrow("down"))
    act(() => mockInput.pressEnter())
    await frame()
    expect(p.picked).toEqual(["error"])
  })
})
