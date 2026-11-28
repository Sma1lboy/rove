/** @jsxImportSource @opentui/react */
/**
 * The frame goldens (`test/render/golden/*.frame.txt`) lock what this sidebar
 * RENDERS — the project header, the per-level indent, the resting and live
 * state glyphs, the pruned search tree — as whole captured frames rather than
 * as substring probes that say nothing about the cells they don't name.
 *
 * This file covers what no frame can: pressing a real key and proving the
 * CALLBACK fired. A `Binding[]` passed as an object literal is enough to kill
 * every key on a page while a frame-only test stays green — a tree whose
 * j/k/enter silently do nothing looks exactly like a tree that renders
 * correctly.
 */
import { expect, test } from "bun:test"
import { useBindings } from "../../src/tui-react/lib/keymap"
import { SidebarTree } from "../../src/tui-react/panes/sidebar/SidebarTree"
import { tabsByTask } from "../../src/tui-react/workspace/terminal-tabs-shared"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"
import { act, renderComponent, waitForFrameText } from "./harness"

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id: toTaskId(id),
    title: id,
    repo: "/repos/rove",
    branch: `feat/${id}`,
    worktreePath: `/wt/${id}`,
    kind: "task",
    status: "in_progress",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  }
}

/** Seed the module-level tab map the tree reads through `knownTaskTabs`. */
function seedTabs(taskId: string, tabIds: readonly string[]): void {
  tabsByTask.set(taskId, {
    tabs: tabIds.map((id, i) => ({ kind: "engine" as const, id, title: `tab ${i + 1}`, ordinal: i + 1 })),
    activeId: tabIds[0] ?? "tab-1",
    nextOrdinal: tabIds.length + 1,
  })
}

/** One input inside act, then a render pass. */
async function step(frame: () => Promise<string>, fire: () => unknown): Promise<void> {
  act(() => {
    fire()
  })
  await frame()
}

function tree(over: Partial<Parameters<typeof SidebarTree>[0]> = {}) {
  return (
    <SidebarTree
      tasks={[task("a"), task("b")]}
      selectedId="a"
      onSelect={() => {}}
      focused={true}
      width={28}
      {...over}
    />
  )
}

test("a child task is its own row: j reaches it and enter selects it", async () => {
  tabsByTask.clear()
  const chosen: string[] = []
  const tasks = [task("a"), task("kid", { parentTaskId: toTaskId("a") }), task("b")]
  const { frame, mockInput } = await renderComponent(tree({ tasks, onSelect: (id) => chosen.push(id) }), {
    width: 28,
    height: 20,
  })
  // Cursor lands on the selected `a`; j steps onto its child.
  await step(frame, () => mockInput.typeText("j"))
  await step(frame, () => mockInput.pressEnter())

  expect(chosen).toEqual(["kid"])
})

test("j/k move the cursor over worktree rows", async () => {
  tabsByTask.clear()
  const chosen: string[] = []
  const { frame, mockInput } = await renderComponent(tree({ onSelect: (id) => chosen.push(id) }), {
    width: 28,
    height: 20,
  })

  // No tabs seeded, so every row is a worktree: a, b — cursor starts on
  // the selected `a`. `selectedId` is a fixed prop here (a real host would
  // re-render with the new one and the follow effect would re-anchor), so
  // the cursor moves freely: j lands on `b`, k returns to `a`.
  await step(frame, () => mockInput.typeText("j"))
  await step(frame, () => mockInput.pressEnter())
  await step(frame, () => mockInput.typeText("k"))
  await step(frame, () => mockInput.pressEnter())

  // Two DIFFERENT ids — a cursor that never moved would report `a` twice.
  expect(chosen).toEqual(["b", "a"])
})

test("keys stay dead while another pane holds focus", async () => {
  // The tree binds bare j/k/h/l. Focused elsewhere it must not consume them —
  // the terminal pane needs them as text.
  seedTabs("a", ["tab-1"])
  const picked: string[] = []
  const { frame, mockInput } = await renderComponent(tree({ focused: false, onSelect: (id) => picked.push(id) }), {
    width: 28,
    height: 20,
  })
  await step(frame, () => mockInput.typeText("j"))
  await step(frame, () => mockInput.pressEnter())

  expect(picked).toEqual([])
})

test("escape leaves search and restores the full tree", async () => {
  tabsByTask.clear()
  const tasks = [task("a", { title: "alpha" }), task("b", { title: "bravo" })]
  const { frame, mockInput } = await renderComponent(tree({ tasks }), { width: 28, height: 20 })

  await step(frame, () => mockInput.typeText("/"))
  await step(frame, () => mockInput.typeText("bravo"))
  expect(await frame()).not.toContain("alpha")

  act(() => mockInput.pressEscape())
  // A lone ESC resolves only after opentui's escape-sequence window.
  const text = await waitForFrameText(frame, "alpha")
  expect(text).toContain("bravo")
})

test("search enters a folded directory task by its name and restores the project fold", async () => {
  tabsByTask.clear()
  const target = task("target", { kind: "dir", title: "Publish build notes", branch: "" })
  const other = task("other", { repo: "/repos/other", title: "Other task" })
  const entered: string[] = []
  const { frame, mockInput, mockMouse } = await renderComponent(
    tree({
      tasks: [target, task("first", { repo: "/repos/other" }), other],
      selectedId: other.id,
      onActivate: (id) => entered.push(id),
    }),
    { width: 32, height: 22 },
  )
  const open = await waitForFrameText(frame, "Publish build notes")
  const header = open.split("\n").findIndex((line) => line.includes("rove") && !line.includes("[ rove ]"))
  await mockMouse.click(2, header, 0)
  // Waited for, not read at once: the fold lands a render after the click.
  expect(await waitForFrameText(frame, "rove ›")).not.toContain("Publish build notes")
  await step(frame, () => mockInput.typeText("/"))
  await step(frame, () => mockInput.typeText("Publish build"))
  expect(await frame()).toContain("Publish build notes")
  act(() => mockInput.pressEscape())
  await waitForFrameText(frame, "rove ›")
  await step(frame, () => mockInput.pressEnter())
  expect(entered).toEqual(["other"])
  await step(frame, () => mockInput.typeText("/"))
  await step(frame, () => mockInput.typeText("Publish build"))
  await step(frame, () => mockInput.pressEnter())
  expect(entered).toEqual(["other", "target"])
  const closed = await frame()
  expect(closed).toContain("rove ›")
  expect(closed).not.toContain("Publish build notes")
  await step(frame, () => mockInput.pressEnter())
  expect(entered).toEqual(["other", "target", "other"])
})

// ─── Move mode is scope-aware: the cursor row's LEVEL moves ───

test("move mode on a TASK row moves the task itself within its repo group", async () => {
  tabsByTask.clear()
  const moves: Array<[string, number]> = []
  const tasks = [task("a"), task("x", { repo: "/repos/foxychat", branch: "feat/x" })]
  const { frame, mockInput } = await renderComponent(
    tree({ tasks, moveMode: true, onMoveRequest: (id, delta) => moves.push([id, delta]) }),
    { width: 28, height: 20 },
  )

  // The cursor sits on `a`, so j/k move IT (the repo-group partition lives
  // in moveTask), not its project.
  await step(frame, () => mockInput.typeText("j"))
  await step(frame, () => mockInput.typeText("k"))

  expect(moves).toEqual([
    ["a", 1],
    ["a", -1],
  ])
  // …the cursor did NOT walk (j/k belong to the drag), and the dragged ROW
  // wears the chip — not the project header.
  expect(await frame()).toContain(" move")
})

test("escape leaves move mode", async () => {
  tabsByTask.clear()
  let exited = 0
  const { mockInput } = await renderComponent(tree({ moveMode: true, onMoveModeExit: () => exited++ }), {
    width: 28,
    height: 20,
  })
  act(() => mockInput.pressEscape())
  // A lone ESC resolves only after opentui's escape-sequence window.
  expect(await waitForFrameText(async () => `exited=${exited}`, "exited=1")).toBe("exited=1")
})

// Regression: when no transient mode is active, the sidebar must not register
// an escape binding. If it does, dispatch considers it a match and swallows the
// key, even though the handler is a no-op.
test("escape bubbles out when no sidebar mode is active", async () => {
  tabsByTask.clear()
  let escaped = false
  function LowerEscape() {
    useBindings(() => ({
      enabled: true,
      bindings: [
        {
          key: "escape",
          cmd: () => {
            escaped = true
          },
        },
      ],
    }))
    return null
  }
  const { mockInput } = await renderComponent(
    <>
      <LowerEscape />
      {tree()}
    </>,
  )
  act(() => mockInput.pressEscape())
  // A lone ESC resolves only after opentui's escape-sequence window.
  expect(await waitForFrameText(async () => `escaped=${escaped}`, "escaped=true")).toBe("escaped=true")
})
