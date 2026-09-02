/** @jsxImportSource @opentui/react */
/**
 * Run-again confirm (`component/run-again-dialog.tsx`) — REAL keypresses
 * against the mounted view.
 *
 * The load-bearing property is that the brief survives the round trip
 * VERBATIM: the whole point of the entry is re-running the exact words, and a
 * flattened or clipped multi-line brief looks completely correct on screen
 * while re-running something the user never wrote. So the tests assert the
 * blank line and the trailing constraint, not just the opening sentence.
 *
 * The second is the commit mapping. Confirming CREATES a task, so a stray
 * Enter must not land on cancel and a stray Escape must not land on confirm.
 */

import { describe, expect, test } from "bun:test"
import { RunAgainDialogView } from "../../src/tui-react/component/run-again-dialog"
import { type RenderHandle, act, renderComponent, settle } from "./harness"

const BRIEF = "Print the third line of README.md.\n\nStop after that — do not edit anything."

function mount(prompt: string = BRIEF): Promise<RenderHandle> & { picked: boolean[] } {
  const picked: boolean[] = []
  const p = renderComponent(
    <RunAgainDialogView
      taskTitle="seed the brief"
      prompt={prompt}
      onConfirm={() => picked.push(true)}
      onCancel={() => picked.push(false)}
    />,
    { providers: { dialog: true }, width: 90, height: 24 },
  ) as Promise<RenderHandle> & { picked: boolean[] }
  p.picked = picked
  return p
}

describe("RunAgainDialogView", () => {
  test("shows the source task and the brief's every line, blank line included", async () => {
    const { frame } = await mount()
    const f = await frame()
    expect(f).toContain("Run again")
    expect(f).toContain("seed the brief")
    expect(f).toContain("Print the third line of README.md.")
    // The constraint after the blank line is the half a single-line preview
    // would have dropped.
    expect(f).toContain("do not edit anything")
    // And it says what confirming does — a new task, not a restart in place.
    expect(f).toContain("new task")
  })

  test("enter commits the re-run — the confirm button is where focus opens", async () => {
    const p = mount()
    const { frame, mockInput } = await p
    await frame()
    act(() => mockInput.pressEnter())
    await frame()
    expect(p.picked).toEqual([true])
  })

  test("left moves to cancel, and enter there cancels instead of creating", async () => {
    const p = mount()
    const { frame, mockInput } = await p
    await frame()
    act(() => mockInput.pressArrow("left"))
    act(() => mockInput.pressEnter())
    await frame()
    expect(p.picked).toEqual([false])
  })

  test("up/down scroll the brief instead of moving between the buttons", async () => {
    // The two gestures share one dialog; if `down` were wired to the button
    // row, a user scrolling a long brief would silently arm Cancel.
    const p = mount(Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n"))
    const { frame, mockInput } = await p
    await frame()
    act(() => mockInput.pressArrow("down"))
    await settle()
    act(() => mockInput.pressEnter())
    await frame()
    expect(p.picked).toEqual([true])
  })
})
