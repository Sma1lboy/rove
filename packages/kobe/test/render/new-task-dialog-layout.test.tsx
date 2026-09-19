/** @jsxImportSource @opentui/react */
import { expect, test } from "bun:test"
import { BoxRenderable, type Renderable, ScrollBoxRenderable } from "@opentui/core"
import { useEffect, useRef } from "react"
import { NewTaskDialogView } from "../../src/tui-react/component/new-task-dialog/dialog"
import { useNewTaskViewModel } from "../../src/tui-react/component/new-task-dialog/view-model"
import { useDialog } from "../../src/tui-react/ui/dialog"
import type { DialogTab, Field } from "../../src/tui/component/new-task-dialog/state"
import { type RenderHandle, act, renderComponent, settle } from "./harness"

const ENGINES = ["claude", "codex", "kimi", "claudex --dangerously-skip-permissions", "opencode"]

function OpenDialog() {
  const dialog = useDialog()
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    dialog.replace(() => (
      <NewTaskDialogView
        defaultRepo={process.cwd()}
        savedRepos={[]}
        defaultCloneParent="/tmp/rove-layout-no-such-parent"
        availableVendors={ENGINES}
        discoverAdoptable={async () =>
          Array.from({ length: 15 }, (_, i) => ({
            path: `/tmp/layout-adopt/${i}`,
            branch: `feature/layout-${i}`,
            head: "abcdef",
            dirty: false,
            kobeManaged: false,
            lastActivityMs: 0,
          }))
        }
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    ))
  }, [dialog.replace])
  return <text>{Array.from({ length: 60 }, () => "BACKGROUND ".repeat(20)).join("\n")}</text>
}

async function mount(width: number, height: number) {
  const handle = await renderComponent(<OpenDialog />, { width, height, providers: { kv: true, dialog: true } })
  await settle()
  return handle
}

/**
 * Tab until the caller's landmark shows up on screen, capped.
 *
 * These tests used to count Tab presses ("tabs → depth → engine → model →
 * git url"). Three of those stops were removed in 2026-09 and every count
 * silently pointed one field too far. Walking to a landmark survives the
 * field list changing again.
 */
async function tabUntil(handle: RenderHandle, marker: string, max = 12): Promise<string> {
  let frame = await handle.frame()
  for (let i = 0; i < max && !frame.includes(marker); i++) {
    await press(handle, "tab")
    frame = await handle.frame()
  }
  return frame
}

/** Tab until focus reaches the Create button — i.e. the end of the form,
 *  however many fields it has today. */
async function tabToEnd(handle: RenderHandle, max = 12): Promise<string> {
  let frame = await handle.frame()
  for (let i = 0; i < max; i++) {
    await press(handle, "tab")
    frame = await handle.frame()
    if (/\[ Create \]/.test(frame) && !/↓ \d+ more rows/.test(frame)) return frame
  }
  return frame
}

function descendants(root: Renderable): Renderable[] {
  return root.getChildren().flatMap((child) => [child, ...descendants(child)])
}

async function press(handle: RenderHandle, key: "right" | "tab" | "down") {
  act(() => (key === "tab" ? handle.mockInput.pressTab() : handle.mockInput.pressArrow(key)))
  await settle()
}

for (const { width, height } of [
  { width: 200, height: 60 },
  { width: 120, height: 40 },
]) {
  test(`${width}x${height}: wrapped engines and inputs keep full borders above the footer`, async () => {
    const h = await mount(width, height)
    await press(h, "right")
    // Walk to the clone form's first input rather than counting stops.
    await tabUntil(h, "FROM URL")
    await act(async () => h.mockInput.typeText("https://github.com/Sma1lboy/mc-rpg.git"))
    await h.frame()
    const boxes = descendants(h.renderer.root).filter(
      (node): node is BoxRenderable => node instanceof BoxRenderable && !!node.border,
    )
    // Structural, not a count: the dialog's field list changes (depth, model
    // and effort were removed in 2026-09), and a hard-coded 17 turned that
    // into six red tests about box arithmetic rather than about layout. What
    // this guards is that EVERY bordered well is one row tall with its border
    // intact, and that wrapping stacks rows instead of overlapping them.
    expect(boxes.length).toBeGreaterThan(6)
    for (const box of boxes) expect(box.height).toBe(3)
    // Chips wrap onto whole rows: every well sits on a row boundary shared
    // with its neighbours, never half-overlapping one.
    const rows = [...new Set(boxes.map((box) => box.y))].sort((a, b) => a - b)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]! - rows[i - 1]!).toBeGreaterThanOrEqual(3)
    }
    for (let i = 0; i < 3; i++) await press(h, "tab")
    const frame = await h.frame()
    const lines = frame.split("\n")
    const footer = lines.findIndex((line) => line.includes("enter next field"))
    // Asserted on the FRAME, not on renderable coordinates. The scrollbox is
    // `overflow: hidden`, so a well scrolled past the viewport keeps its y in
    // the tree while drawing nothing — walking the tree counted those and
    // reported collisions that are invisible on screen. What matters is that
    // no box-drawing character lands on the footer's row or below it.
    for (const row of lines.slice(footer)) {
      expect(row, "a well is drawn on or below the footer's row").not.toMatch(/[╭╮╰╯│─]/)
    }
    expect(frame).toContain("[ Create ]")
    const first = lines.findIndex((line) => line.includes("New task"))
    const left = lines[first]!.indexOf("New task") - 2
    for (const line of lines.slice(first, footer + 3)) expect(line.slice(left, left + 80)).not.toContain("BACKGROUND")
    act(() => h.destroy())
  })
}

for (const mode of ["existing", "adopt"] as const) {
  test(`${mode}: wrapped chips and picker rows stay inside the modal`, async () => {
    // 48 rows, not 40: the depth and model rows pushed FROM BRANCH below a
    // 40-row fold at open, and this test is about wrapping, not scrolling.
    const h = await mount(120, 48)
    if (mode === "adopt") {
      await press(h, "right")
      await press(h, "right")
    }
    // The tab's first input, reached by landmark rather than by count.
    await tabUntil(h, mode === "adopt" ? "FILTER" : "FROM BRANCH")
    if (mode === "adopt") {
      for (let i = 0; i < 14; i++) await press(h, "down")
    }
    const frame = await h.frame()
    expect(frame).toContain(mode === "adopt" ? "▸ [ ] feature/layout-14" : "FROM BRANCH")
    expect(frame).toContain("New task")
    expect(frame).toContain("[ Create ]")
    const boxes = descendants(h.renderer.root).filter(
      (node): node is BoxRenderable => node instanceof BoxRenderable && !!node.border,
    )
    for (const box of boxes) expect(box.height).toBe(3)
    const scroll = descendants(h.renderer.root).find(
      (node): node is ScrollBoxRenderable => node instanceof ScrollBoxRenderable,
    )
    expect(scroll).toBeDefined()
    const footer = frame.split("\n").findIndex((line) => line.includes("enter next field"))
    expect(footer).toBeGreaterThan(scroll!.y + scroll!.height)
    act(() => h.destroy())
  })
}

test("a focused last field remains visible after narrowing and shortening the terminal", async () => {
  const h = await mount(200, 60)
  await press(h, "right")
  // Tab to the clone form's LAST field. Counting presses ("7 tabs") broke
  // when three fields were removed, and waiting for the label to appear is
  // circular: the label showing up is the very thing this test checks, so a
  // scroll that fails to follow focus would just spin here instead of
  // failing. Press a fixed number past the end — extra Tabs wrap around the
  // cycle harmlessly — then assert the focused field is on screen.
  for (let i = 0; i < 5; i++) await press(h, "tab")
  act(() => h.resize(64, 40))
  await settle()
  let frame = await h.frame()
  expect(frame).toContain("BASE BRANCH")
  expect(frame).toContain("[ Create ]")
  const boxes = descendants(h.renderer.root).filter(
    (node): node is BoxRenderable => node instanceof BoxRenderable && !!node.border,
  )
  for (const box of boxes) {
    expect(box.height).toBe(3)
    expect(box.x + box.width).toBeLessThanOrEqual(63)
  }
  act(() => h.resize(120, 24))
  await settle()
  frame = await h.frame()
  expect(frame).toContain("BASE BRANCH")
  expect(frame).toContain("[ Create ]")
  expect(frame).not.toContain("╭")
  act(() => h.destroy())
})

for (const { width, height } of [
  { width: 153, height: 35 },
  { width: 153, height: 34 },
  // The compact form grew a depth row and a MODEL well, so it scrolls even
  // on 33 rows; what it must still keep is the footer glued above Create.
  { width: 200, height: 33 },
]) {
  test(`${width}x${height}: footer spacing leaves the parent well or compact form intact`, async () => {
    const h = await mount(width, height)
    await press(h, "right")
    for (let i = 0; i < 4; i++) await press(h, "tab")
    await act(async () => h.mockInput.typeText("https://github.com/Sma1lboy/mc-rpg.git"))
    const frame = await h.frame()
    const scroll = descendants(h.renderer.root).find(
      (node): node is ScrollBoxRenderable => node instanceof ScrollBoxRenderable,
    )!
    const lines = frame.split("\n")
    const create = lines.findIndex((line) => line.includes("[ Create ]"))
    const legendEnd = lines.findIndex((line) => line.includes("esc cancel"))
    expect(create).toBe(legendEnd + 1)
    if (height >= 34) {
      const wells = descendants(h.renderer.root).filter(
        (node): node is BoxRenderable => node instanceof BoxRenderable && !!node.border,
      )
      // The LAST well laid out inside the viewport, found rather than
      // indexed: which ordinal it is depends on the field list.
      const visible = wells.filter((w) => w.y + w.height <= scroll.viewport.y + scroll.viewport.height)
      const parent = visible.at(-1)!
      expect(parent.height).toBe(3)
      expect(parent.y + parent.height).toBeLessThanOrEqual(scroll.viewport.y + scroll.viewport.height)
      // Scrolling exists while content is below the fold, and the hints tell
      // the truth in both directions. Asserted as an invariant rather than as
      // "exactly N tabs reaches the bottom": the field count changed in
      // 2026-09 and every such count pointed somewhere else afterwards.
      const overflowed = /↓ \d+ more rows/.test(frame)
      const bottom = await tabToEnd(h)
      if (overflowed) expect(bottom).toMatch(/↑ \d+ more rows|\[ Create \]/)
    } else {
      // Whether this form still overflows a short terminal depends on how
      // many fields it has, and that changed (depth/model/effort left in
      // 2026-09 — at 200x33 the content now fits exactly). So assert the
      // INVARIANT rather than the overflow: the scroll hint appears when
      // there is something below the fold, and never when there is not.
      if (scroll.scrollHeight > scroll.viewport.height) {
        expect(frame).toMatch(/↓ \d+ more rows/)
      } else {
        expect(frame).not.toMatch(/↓ \d+ more rows/)
      }
    }
    act(() => h.destroy())
  })
}

/**
 * Creating a task asks WHERE, WITH WHICH ENGINE, and OPENING WHAT — not about
 * depth, model or reasoning level (owner 2026-09-19). Depth and effort belong
 * to auto-effort, which owns that decision in Settings; a pinned model is a
 * per-task exception. All three stay settable after the fact.
 *
 * Driven through the REAL view model's `advanceFrom`, not through `nextField`
 * with hand-written flags. Two earlier versions of this test could never
 * fail: one checked the frame for "EFFORT" (that block only renders when the
 * engine declares levels, and this fixture's does not), and one passed its
 * own `effortVisible: false` into `nextField` — testing its own argument.
 * What matters is what the dialog PASSES, which is only observable here.
 *
 * Why it is a keyboard bug and not a cosmetic one: view-model.ts warns three
 * lines above that call that parking focus on an invisible input swallows
 * every keystroke after it.
 */
function FocusWalk(props: { tab: DialogTab; onDone: (seen: readonly Field[]) => void }) {
  const vm = useNewTaskViewModel({
    defaultRepo: "/tmp/repo",
    savedRepos: [],
    defaultCloneParent: "/tmp",
    availableVendors: ENGINES,
    discoverAdoptable: async () => [],
    onSubmit: () => {},
    onCancel: () => {},
  })
  const ran = useRef(false)
  useEffect(() => {
    if (ran.current) return
    ran.current = true
    const seen: Field[] = []
    let field: Field = "tabs"
    for (let i = 0; i < 24 && !seen.includes(field); i++) {
      seen.push(field)
      field = vm.advanceFieldFor(field, props.tab)
    }
    props.onDone(seen)
  }, [vm, props.tab, props.onDone])
  return <text>walk</text>
}

test("Tab never stops on a field this dialog no longer renders", async () => {
  for (const tab of ["existing", "clone", "adopt"] as const) {
    let seen: readonly Field[] = []
    await renderComponent(
      <FocusWalk
        tab={tab}
        onDone={(s) => {
          seen = s
        }}
      />,
      {
        width: 100,
        height: 40,
        providers: { kv: true, dialog: true },
      },
    )
    await settle()
    for (const gone of ["tier", "model", "effort"] as const) {
      expect([...seen], `${tab}: Tab still stops on the removed ${gone} row`).not.toContain(gone)
    }
    expect([...seen], `${tab}: Tab no longer reaches the engine row`).toContain("engine")
  }
})
