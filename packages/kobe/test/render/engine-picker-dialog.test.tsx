/** @jsxImportSource @opentui/react */
/**
 * Change-engine picker (`component/engine-picker-dialog.tsx`) — REAL
 * keypresses against the mounted view, same shape as the status-picker test.
 *
 * The list is rendered from the `engines` prop and the commit indexes back
 * into it, so an off-by-one produces a dialog that looks right and persists
 * the neighbouring engine. Every test asserts the value that came OUT.
 *
 * The effort row is the second axis: it exists only for engines that DECLARE
 * levels (codex), and a level must never ride along with an engine that
 * declares none — that is the silent drop `withEngineEffort` performs at
 * launch, and the dialog must not manufacture it. The model row is the
 * third: every engine here declares a model flag, so `model` always rides
 * (`""` = clear), and a pinned model never follows the cursor to another
 * engine — a claude alias on codex kills the launch.
 */

import { describe, expect, test } from "bun:test"
import { type EnginePickResult, EnginePickerDialogView } from "../../src/tui-react/component/engine-picker-dialog"
import type { VendorId } from "../../src/types/task"
import { type RenderHandle, act, renderComponent, settle } from "./harness"

const ENGINES: readonly VendorId[] = ["claude", "codex", "kimi"]

function mount(
  current: VendorId = "claude",
  currentEffort?: string,
  currentModel?: string,
): Promise<RenderHandle> & { picked: EnginePickResult[] } {
  const picked: EnginePickResult[] = []
  const p = renderComponent(
    <EnginePickerDialogView
      engines={ENGINES}
      current={current}
      currentEffort={currentEffort}
      currentModel={currentModel}
      onSubmit={(v) => picked.push(v)}
      onCancel={() => {}}
    />,
    { providers: { dialog: true } },
  ) as Promise<RenderHandle> & { picked: EnginePickResult[] }
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
    const p = mount("kimi")
    const { frame, mockInput } = await p
    await frame()
    act(() => mockInput.pressEnter())
    await frame()
    expect(p.picked).toEqual([{ vendor: "kimi", model: "" }])
  })

  test("down then enter commits the NEXT engine in list order", async () => {
    const p = mount("claude")
    const { frame, mockInput } = await p
    await frame()
    act(() => mockInput.pressArrow("down"))
    act(() => mockInput.pressEnter())
    await frame()
    expect(p.picked).toEqual([{ vendor: "codex", effort: "", model: "" }])
  })

  test("the cursor clamps at both ends instead of wrapping", async () => {
    const p = mount("kimi")
    const { frame, mockInput } = await p
    await frame()
    act(() => mockInput.pressArrow("down"))
    act(() => mockInput.pressArrow("down"))
    act(() => mockInput.pressEnter())
    await frame()
    expect(p.picked).toEqual([{ vendor: "kimi", model: "" }])
    act(() => mockInput.pressArrow("up"))
    act(() => mockInput.pressArrow("up"))
    act(() => mockInput.pressArrow("up"))
    act(() => mockInput.pressArrow("up"))
    act(() => mockInput.pressEnter())
    await frame()
    expect(p.picked).toEqual([
      { vendor: "kimi", model: "" },
      { vendor: "claude", model: "" },
    ])
  })

  test("an engine with no declared levels renders no effort row at all", async () => {
    // Claude has no effort flag Rove can drive; offering one would promise a
    // setting the launch path drops.
    const p = mount("claude")
    const { frame } = await p
    const first = await frame()
    expect(first).not.toContain("EFFORT")
    expect(first).toContain("↑↓ engine")
    expect(first).not.toContain("←→ effort")
  })

  test("codex shows its declared levels, and the footer names the new keys", async () => {
    const p = mount("codex")
    const { frame } = await p
    const first = await frame()
    expect(first).toContain("EFFORT")
    expect(first).toContain("engine default")
    for (const level of ["low", "medium", "high", "xhigh"]) expect(first).toContain(level)
    expect(first).toContain("←→ effort")
  })

  test("right arrow steps the level and enter commits engine + level together", async () => {
    const p = mount("codex")
    const { frame, mockInput } = await p
    await frame()
    // choices are [engine default, none, low, medium, high, xhigh, max]
    for (let i = 0; i < 5; i++) act(() => mockInput.pressArrow("right"))
    act(() => mockInput.pressEnter())
    await frame()
    expect(p.picked).toEqual([{ vendor: "codex", effort: "xhigh", model: "" }])
  })

  test("opens ON the task's recorded level, so enter alone never rewrites it", async () => {
    const p = mount("codex", "high")
    const { frame, mockInput } = await p
    await frame()
    act(() => mockInput.pressEnter())
    await frame()
    expect(p.picked).toEqual([{ vendor: "codex", effort: "high", model: "" }])
  })

  test("a level never rides along to an engine that declares none", async () => {
    // The task is on codex/xhigh; moving the cursor to kimi must submit no
    // level rather than a codex level kimi would silently drop.
    const p = mount("codex", "xhigh")
    const { frame, mockInput } = await p
    await frame()
    act(() => mockInput.pressArrow("down"))
    act(() => mockInput.pressEnter())
    await frame()
    expect(p.picked).toEqual([{ vendor: "kimi", model: "" }])
  })

  test("stepping left off the first level lands on the engine default, which clears it", async () => {
    const p = mount("codex", "low")
    const { frame, mockInput } = await p
    await frame()
    act(() => mockInput.pressArrow("left"))
    act(() => mockInput.pressArrow("left"))
    act(() => mockInput.pressEnter())
    await frame()
    // `""` is the wire spelling of "clear the level", distinct from absent.
    expect(p.picked).toEqual([{ vendor: "codex", effort: "", model: "" }])
  })

  test("tab reaches the model input; typed text is pinned verbatim on enter", async () => {
    const p = mount("claude")
    const { mockInput } = await p
    await settle()
    act(() => mockInput.pressTab())
    await settle()
    await act(async () => mockInput.typeText("opus"))
    await settle()
    act(() => mockInput.pressEnter())
    await settle()
    expect(p.picked).toEqual([{ vendor: "claude", model: "opus" }])
  })

  test("opens ON the task's pinned model, so enter alone keeps it", async () => {
    const p = mount("claude", undefined, "sonnet")
    const { frame, mockInput } = await p
    await settle()
    const first = await frame()
    expect(first).toContain("MODEL")
    expect(first).toContain("sonnet")
    act(() => mockInput.pressEnter())
    await settle()
    expect(p.picked).toEqual([{ vendor: "claude", model: "sonnet" }])
  })

  test("a pinned model never follows the cursor to another engine", async () => {
    // claude/sonnet → codex must submit an EMPTY model (clear), not `sonnet`.
    const p = mount("claude", undefined, "sonnet")
    const { mockInput } = await p
    await settle()
    act(() => mockInput.pressArrow("down"))
    await settle()
    act(() => mockInput.pressEnter())
    await settle()
    expect(p.picked).toEqual([{ vendor: "codex", effort: "", model: "" }])
  })
})
