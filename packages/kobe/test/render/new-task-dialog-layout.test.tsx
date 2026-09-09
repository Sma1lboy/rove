/** @jsxImportSource @opentui/react */
import { expect, test } from "bun:test"
import { BoxRenderable, type Renderable, ScrollBoxRenderable } from "@opentui/core"
import { useEffect, useRef } from "react"
import { NewTaskDialogView } from "../../src/tui-react/component/new-task-dialog/dialog"
import { useDialog } from "../../src/tui-react/ui/dialog"
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
    await press(h, "tab")
    await press(h, "tab")
    await act(async () => h.mockInput.typeText("https://github.com/Sma1lboy/mc-rpg.git"))
    await h.frame()
    const boxes = descendants(h.renderer.root).filter(
      (node): node is BoxRenderable => node instanceof BoxRenderable && !!node.border,
    )
    expect(boxes.length).toBe(12)
    for (const box of boxes) expect(box.height).toBe(3)
    const firstEngine = boxes[3]!
    const wrappedEngine = boxes[6]!
    expect(wrappedEngine.y).toBe(firstEngine.y + firstEngine.height)
    const urlField = boxes[8]!
    // One label row and one blank row separate the next well from the chips.
    expect(urlField.y).toBe(wrappedEngine.y + wrappedEngine.height + 2)
    for (let i = 0; i < 3; i++) await press(h, "tab")
    const frame = await h.frame()
    const lines = frame.split("\n")
    const footer = lines.findIndex((line) => line.includes("enter next field"))
    const lastBorder = Math.max(...boxes.map((box) => box.y + box.height - 1))
    expect(footer).toBeGreaterThan(lastBorder + 1)
    expect(frame).toContain("[ Create ]")
    const first = lines.findIndex((line) => line.includes("New task"))
    const left = lines[first]!.indexOf("New task") - 2
    for (const line of lines.slice(first, footer + 3)) expect(line.slice(left, left + 80)).not.toContain("BACKGROUND")
    act(() => h.destroy())
  })
}

for (const mode of ["existing", "adopt"] as const) {
  test(`${mode}: wrapped chips and picker rows stay inside the modal`, async () => {
    const h = await mount(120, 40)
    if (mode === "adopt") {
      await press(h, "right")
      await press(h, "right")
    }
    await press(h, "tab")
    await press(h, "tab")
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
  for (let i = 0; i < 5; i++) await press(h, "tab")
  await h.frame()
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
  { width: 200, height: 30 },
]) {
  test(`${width}x${height}: footer spacing leaves the parent well or compact form intact`, async () => {
    const h = await mount(width, height)
    await press(h, "right")
    await press(h, "tab")
    await press(h, "tab")
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
      const parent = wells[9]!
      expect(parent.height).toBe(3)
      expect(parent.y + parent.height).toBeLessThanOrEqual(scroll.viewport.y + scroll.viewport.height)
      expect(frame).toMatch(/↓ \d+ more rows/)
      for (let i = 0; i < 3; i++) await press(h, "tab")
      const bottom = await h.frame()
      expect(bottom).toMatch(/↑ \d+ more rows/)
      expect(bottom).not.toMatch(/↓ \d+ more rows/)
    } else {
      expect(scroll.scrollHeight).toBeLessThanOrEqual(scroll.viewport.height)
      const base = lines.findIndex((line) => line.includes("BASE BRANCH"))
      expect(lines[base + 1]).toContain("main")
      expect(frame).not.toContain("more rows")
    }
    act(() => h.destroy())
  })
}
