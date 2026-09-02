/** @jsxImportSource @opentui/react */
/**
 * Change-engine picker (`component/engine-picker-dialog.tsx`) — REAL
 * keypresses against the mounted view, same shape as the status-picker test.
 *
 * The list is rendered from the `engines` prop and the commit indexes back
 * into it, so an off-by-one produces a dialog that looks right and persists
 * the neighbouring engine. Every test asserts the value that came OUT.
 */

import { describe, expect, test } from "bun:test"
import { EnginePickerDialogView } from "../../src/tui-react/component/engine-picker-dialog"
import type { VendorId } from "../../src/types/task"
import { type RenderHandle, act, renderComponent } from "./harness"

const ENGINES: readonly VendorId[] = ["claude", "codex", "kimi"]

function mount(current: VendorId = "claude"): Promise<RenderHandle> & { picked: VendorId[] } {
  const picked: VendorId[] = []
  const p = renderComponent(
    <EnginePickerDialogView engines={ENGINES} current={current} onSubmit={(v) => picked.push(v)} onCancel={() => {}} />,
    { providers: { dialog: true } },
  ) as Promise<RenderHandle> & { picked: VendorId[] }
  p.picked = picked
  return p
}

describe("EnginePickerDialogView", () => {
  test("lists every available engine by display name and marks the current one", async () => {
    const p = mount("codex")
    const { frame } = await p
    const first = await frame()
    expect(first).toContain("Change engine")
    for (const label of ["Claude", "Codex", "Kimi"]) expect(first).toContain(label)
    expect(first).toContain("current")
  })

  test("opens ON the task's current engine — enter alone re-picks it, never a neighbour", async () => {
    const p = mount("codex")
    const { frame, mockInput } = await p
    await frame()
    act(() => mockInput.pressEnter())
    await frame()
    expect(p.picked).toEqual(["codex"])
  })

  test("down then enter commits the NEXT engine in list order", async () => {
    const p = mount("claude")
    const { frame, mockInput } = await p
    await frame()
    act(() => mockInput.pressArrow("down"))
    act(() => mockInput.pressEnter())
    await frame()
    expect(p.picked).toEqual(["codex"])
  })

  test("the cursor clamps at both ends instead of wrapping", async () => {
    const p = mount("kimi")
    const { frame, mockInput } = await p
    await frame()
    act(() => mockInput.pressArrow("down"))
    act(() => mockInput.pressArrow("down"))
    act(() => mockInput.pressEnter())
    await frame()
    expect(p.picked).toEqual(["kimi"])
    act(() => mockInput.pressArrow("up"))
    act(() => mockInput.pressArrow("up"))
    act(() => mockInput.pressArrow("up"))
    act(() => mockInput.pressArrow("up"))
    act(() => mockInput.pressEnter())
    await frame()
    expect(p.picked).toEqual(["kimi", "claude"])
  })
})
