/** @jsxImportSource @opentui/react */
import { expect, test } from "bun:test"
import { BoxRenderable, type Renderable, ScrollBoxRenderable } from "@opentui/core"
import { useEffect, useRef } from "react"
import { NewTaskDialogView } from "../../src/tui-react/component/new-task-dialog/dialog"
import { useNewTaskViewModel } from "../../src/tui-react/component/new-task-dialog/view-model"
import { useDialog } from "../../src/tui-react/ui/dialog"
import { type DialogTab, type Field, nextField } from "../../src/tui/component/new-task-dialog/state"
import { type RenderHandle, act, isolateHome, renderComponent, settle } from "./harness"

isolateHome()

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
            roveManaged: false,
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

/** Press `keys` in order. */
async function pressAll(handle: RenderHandle, keys: readonly ("right" | "tab" | "down")[]) {
  for (const key of keys) await press(handle, key)
}

/** Tab from the dialog's first stop to `target` on the clone form, counted from the focus chain. */
async function tabToCloneField(handle: RenderHandle, target: Field) {
  let field: Field = "tabs"
  let stops = 0
  do {
    field = nextField(field, "clone", { modelVisible: true, effortVisible: true })
    stops++
  } while (field !== target)
  await pressAll(handle, Array(stops).fill("tab"))
}

function borderedBoxes(handle: RenderHandle): BoxRenderable[] {
  return descendants(handle.renderer.root).filter(
    (node): node is BoxRenderable => node instanceof BoxRenderable && !!node.border,
  )
}

function scrollBox(handle: RenderHandle): ScrollBoxRenderable | undefined {
  return descendants(handle.renderer.root).find(
    (node): node is ScrollBoxRenderable => node instanceof ScrollBoxRenderable,
  )
}

test("200x60: wrapped engines and inputs keep full borders above the footer", async () => {
  const h = await mount(200, 60)
  await press(h, "right")
  // Walk to the clone form's first input rather than counting stops.
  await tabUntil(h, "FROM URL")
  await act(async () => h.mockInput.typeText("https://github.com/Sma1lboy/mc-rpg.git"))
  await h.frame()
  const boxes = borderedBoxes(h)
  // Structural, not a count: what this guards is that EVERY bordered well is
  // one row tall with its border intact, and that wrapping stacks rows
  // instead of overlapping them.
  expect(boxes.length).toBeGreaterThan(6)
  expect(new Set(boxes.map((box) => box.height))).toEqual(new Set([3]))
  // Chips wrap onto whole rows: every well sits on a row boundary shared
  // with its neighbours, never half-overlapping one.
  const rows = [...new Set(boxes.map((box) => box.y))].sort((a, b) => a - b)
  const gaps = rows.slice(1).map((row, i) => row - rows[i]!)
  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(3)
  await pressAll(h, ["tab", "tab", "tab"])
  const frame = await h.frame()
  const lines = frame.split("\n")
  const footer = lines.findIndex((line) => line.includes("enter next field"))
  // Asserted on the FRAME, not on renderable coordinates. The scrollbox is
  // `overflow: hidden`, so a well scrolled past the viewport keeps its y in
  // the tree while drawing nothing — walking the tree counted those and
  // reported collisions that are invisible on screen. What matters is that
  // no box-drawing character lands on the footer's row or below it.
  expect(lines.slice(footer).join("\n"), "a well is drawn on or below the footer's row").not.toMatch(/[╭╮╰╯│─]/)
  expect(frame).toContain("[ Create ]")
  const first = lines.findIndex((line) => line.includes("New task"))
  const left = lines[first]!.indexOf("New task") - 2
  const modal = lines.slice(first, footer + 3).map((line) => line.slice(left, left + 80))
  expect(modal.join("\n")).not.toContain("BACKGROUND")
  act(() => h.destroy())
})

test.each([
  { mode: "existing", toTab: [], landmark: "FROM BRANCH", inTab: [], shown: "FROM BRANCH" },
  {
    mode: "adopt",
    toTab: ["right", "right"],
    landmark: "FILTER",
    inTab: Array(14).fill("down"),
    shown: "▸ [ ] feature/layout-14",
  },
] as const)("$mode: wrapped chips and picker rows stay inside the modal", async ({ toTab, landmark, inTab, shown }) => {
  // 64 rows, not 40: the model and effort rows pushed FROM BRANCH below a
  // 40-row fold at open, and this test is about wrapping, not scrolling.
  const h = await mount(120, 64)
  await pressAll(h, toTab)
  // The tab's first input, reached by landmark rather than by count.
  await tabUntil(h, landmark)
  await pressAll(h, inTab)
  const frame = await h.frame()
  expect(frame).toContain(shown)
  expect(frame).toContain("New task")
  expect(frame).toContain("[ Create ]")
  expect(new Set(borderedBoxes(h).map((box) => box.height))).toEqual(new Set([3]))
  const scroll = scrollBox(h)
  expect(scroll).toBeDefined()
  const footer = frame.split("\n").findIndex((line) => line.includes("enter next field"))
  expect(footer).toBeGreaterThan(scroll!.y + scroll!.height)
  act(() => h.destroy())
})

test("a focused last field remains visible after narrowing and shortening the terminal", async () => {
  const h = await mount(200, 72)
  await press(h, "right")
  // The clone form's LAST field (the fixture engine shows model and effort rows).
  await tabToCloneField(h, "cloneBaseRef")
  act(() => h.resize(64, 40))
  await settle()
  let frame = await h.frame()
  expect(frame).toContain("BASE BRANCH")
  expect(frame).toContain("[ Create ]")
  const boxes = borderedBoxes(h)
  expect(new Set(boxes.map((box) => box.height))).toEqual(new Set([3]))
  expect(Math.max(...boxes.map((box) => box.x + box.width))).toBeLessThanOrEqual(63)
  act(() => h.resize(120, 24))
  await settle()
  frame = await h.frame()
  expect(frame).toContain("BASE BRANCH")
  expect(frame).toContain("[ Create ]")
  expect(frame).not.toContain("╭")
  act(() => h.destroy())
})

/** Open the clone form at `width`x`height` and type a URL into it. */
async function compactForm(width: number, height: number) {
  const h = await mount(width, height)
  await press(h, "right")
  await pressAll(h, ["tab", "tab", "tab", "tab"])
  await act(async () => h.mockInput.typeText("https://github.com/Sma1lboy/mc-rpg.git"))
  const frame = await h.frame()
  const lines = frame.split("\n")
  const create = lines.findIndex((line) => line.includes("[ Create ]"))
  // The legend wraps, and where it breaks is the renderer's call: its last line is the one that ends it.
  const legendEnd = lines.findLastIndex((line, index) => index < create && /\bcancel\b/.test(line))
  return { h, frame, scroll: scrollBox(h)!, create, legendEnd }
}

test("153x34: footer spacing leaves the parent well intact and the scroll hints tell the truth", async () => {
  const { h, frame, scroll, create, legendEnd } = await compactForm(153, 34)
  expect(create).toBe(legendEnd + 1)
  // The LAST well laid out inside the viewport, found rather than
  // indexed: which ordinal it is depends on the field list.
  const visible = borderedBoxes(h).filter((w) => w.y + w.height <= scroll.viewport.y + scroll.viewport.height)
  const parent = visible.at(-1)!
  expect(parent.height).toBe(3)
  expect(parent.y + parent.height).toBeLessThanOrEqual(scroll.viewport.y + scroll.viewport.height)
  // Scrolling exists while content is below the fold, and the hints tell the
  // truth in both directions — an invariant, not a count of fields.
  expect(/↓ \d+ more rows/.test(frame)).toBe(scroll.scrollHeight > scroll.viewport.height)
  expect(await tabToEnd(h)).toMatch(/↑ \d+ more rows|\[ Create \]/)
  act(() => h.destroy())
})

test("200x33: the compact form keeps the footer glued above Create, with a scroll hint only on overflow", async () => {
  const { h, frame, scroll, create, legendEnd } = await compactForm(200, 33)
  expect(create).toBe(legendEnd + 1)
  // Whether this form overflows depends on its field count; the hint must
  // appear exactly when there is something below the fold.
  expect(/↓ \d+ more rows/.test(frame)).toBe(scroll.scrollHeight > scroll.viewport.height)
  act(() => h.destroy())
})

/**
 * Creating a task asks WHERE, WITH WHICH ENGINE (and model and effort, for engines that declare
 * them), and OPENING WHAT — not about depth, which stays auto-routing's (docs/DESIGN.md).
 *
 * Driven through the REAL view model's `advanceFrom`, not through `nextField`
 * with hand-written flags. Two earlier versions of this test could never
 * fail: one checked the frame for "EFFORT" (that block only renders when the
 * engine declares levels), and one passed its
 * own `effortVisible: true` into `nextField` — testing its own argument.
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

test.each(["existing", "clone", "adopt"] as const)(
  "%s: Tab stops only on rows the dialog renders: engine, model and declared effort yes, depth never",
  async (tab) => {
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
    expect([...seen], "Tab stops on the depth row, which this dialog does not render").not.toContain("tier")
    // The fixture engine declares levels and a model flag, so both rows are stops.
    expect([...seen], "Tab no longer reaches the effort row").toContain("effort")
    expect([...seen], "Tab no longer reaches the model row").toContain("model")
    expect([...seen], "Tab no longer reaches the engine row").toContain("engine")
  },
)
