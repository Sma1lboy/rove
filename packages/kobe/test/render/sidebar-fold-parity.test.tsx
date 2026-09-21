/** @jsxImportSource @opentui/react */
/**
 * The fold and the full rail must show the SAME projects, in the same order.
 *
 * This is the invariant the two surfaces used to break. The expanded tree
 * derived its sections from `buildTreeRows`, which drops a project you have
 * closed down to nothing and files interleaved tasks under one header; the
 * folded rail walked the raw task list and started a new section whenever the
 * key changed. So a repo the tree had hidden was still a divider in the fold,
 * one project could appear as two, and a scratch session sat wherever the
 * store happened to put it.
 *
 * Both now read `buildSidebarGroups`, so the property below holds by
 * construction. It is asserted on FRAMES rather than on that function's return
 * value because a shared builder proves nothing if a renderer stops using it:
 * what has to stay true is what the reader sees.
 */

import { expect, test } from "bun:test"
import { CollapsedRail, railJumpIds } from "../../src/tui-react/panes/sidebar/collapsed-rail"
import { useSidebarGroups } from "../../src/tui-react/panes/sidebar/use-sidebar-groups"
import { tabsByTask as tabStore } from "../../src/tui-react/workspace/terminal-tabs-shared"
import { jumpSlotTarget, taskJumpDigit } from "../../src/tui/panes/sidebar/jump-digits"
import { buildSidebarGroups } from "../../src/tui/panes/sidebar/project-groups"
import { type TreeTab, buildTreeRows, treeFlatIds } from "../../src/tui/panes/sidebar/tree-core"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"
import { renderComponent } from "./harness"

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id: toTaskId(id),
    title: id,
    repo: "/work/api",
    branch: `feat/${id}`,
    worktreePath: `/wt/${id}`,
    kind: "task",
    status: "in_progress",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  }
}
const main = (id: string, repo: string) => task(id, { kind: "main", repo, branch: "", worktreePath: repo })

/**
 * One fixture drives BOTH paths, so the comparison cannot drift: the rail
 * reads tabs through the module-level store (no KV provider in a render test),
 * and `buildTreeRows` is handed the same counts as a plain map.
 */
function seed(tabSpec: Record<string, readonly string[]>): ReadonlyMap<string, readonly TreeTab[]> {
  tabStore.clear()
  const map = new Map<string, readonly TreeTab[]>()
  for (const [taskId, tabIds] of Object.entries(tabSpec)) {
    tabStore.set(taskId, {
      tabs: tabIds.map((id, i) => ({ kind: "engine" as const, id, title: `tab ${i + 1}`, ordinal: i + 1 })),
      activeId: tabIds[0] ?? "tab-1",
      nextOrdinal: tabIds.length + 1,
    })
    map.set(
      taskId,
      tabIds.map((id) => ({ id, label: id })),
    )
  }
  return map
}

/** The rail as it ships: groups from the shared hook, not a task list. */
function FoldedRail(props: { tasks: readonly Task[] }) {
  const { groups } = useSidebarGroups({ tasks: props.tasks, kv: null })
  return (
    <box height={16} flexDirection="row">
      <CollapsedRail style="digits" groups={groups} selectedId={null} onSelect={() => {}} onExpand={() => {}} />
    </box>
  )
}

/** The section dividers the fold actually painted, top to bottom. A divider is
 *  the only rule character in the strip; the expand control is `››`. */
function dividersOf(frame: string): string[] {
  return frame
    .split("\n")
    .filter((line) => line.includes("─"))
    .map((line) => line.trim().replace(/─+$/, ""))
}

/** What the expanded tree would head each section with — first character of
 *  the header it prints, which is all a 3-cell fold has room for. */
function treeHeads(tasks: readonly Task[], tabs: ReadonlyMap<string, readonly TreeTab[]>): string[] {
  return buildTreeRows({ tasks, tabsByTask: tabs })
    .filter((row) => row.kind === "project")
    .map((row) => (row.kind === "project" ? row.label : ""))
    .map((label) => (new Intl.Segmenter().segment(label.trim()).containing(0)?.segment ?? "·").toLowerCase())
}

async function railDividers(tasks: readonly Task[]): Promise<string[]> {
  const { frame } = await renderComponent(<FoldedRail tasks={tasks} />, { width: 8, height: 16 })
  return dividersOf(await frame())
}

const FIXTURES: ReadonlyArray<{
  name: string
  tasks: readonly Task[]
  tabs: Record<string, readonly string[]>
}> = [
  {
    // The bug this file exists for: a repo closed down to its main checkout
    // with the last tab shut.
    name: "a project closed down to nothing",
    tasks: [main("dead", "/work/dead"), task("live", { repo: "/work/api" })],
    tabs: { dead: [], live: ["tab-1"] },
  },
  {
    // tasks.json interleaves by creation order, so this is the ordinary case,
    // not an exotic one.
    name: "two projects interleaved in the store",
    tasks: [task("a1", { repo: "/work/api" }), task("b1", { repo: "/work/web" }), task("a2", { repo: "/work/api" })],
    tabs: { a1: ["tab-1"], b1: ["tab-1"], a2: ["tab-1"] },
  },
  {
    name: "a scratch session filed after a project",
    tasks: [
      task("a1", { repo: "/work/api" }),
      task("s1", { kind: "dir", repo: "/tmp/scratch", scratch: true, worktreePath: "/tmp/scratch", branch: "" }),
    ],
    tabs: { a1: ["tab-1"], s1: ["tab-1"] },
  },
  {
    name: "a task whose deletion is in flight",
    tasks: [
      task("keep", { repo: "/work/api" }),
      task("going", { repo: "/work/gone", deletion: { phase: "queued" } } as Partial<Task>),
    ],
    tabs: { keep: ["tab-1"], going: ["tab-1"] },
  },
  {
    name: "tabs that have never mounted since restart",
    tasks: [main("m", "/work/api"), main("n", "/work/web")],
    tabs: {},
  },
]

for (const fixture of FIXTURES) {
  test(`the fold heads the same sections, in the same order — ${fixture.name}`, async () => {
    const tabs = seed(fixture.tabs)
    expect(await railDividers(fixture.tasks)).toEqual(treeHeads(fixture.tasks, tabs))
  })
}

test("the closed-down project is in neither surface, not merely ordered the same", async () => {
  // The parity property above would also be satisfied by both surfaces showing
  // the dead project. This pins the direction.
  const tasks = [main("dead", "/work/dead"), task("live", { repo: "/work/api" })]
  const tabs = seed({ dead: [], live: ["tab-1"] })

  expect(treeHeads(tasks, tabs)).toEqual(["a"])
  const dividers = await railDividers(tasks)
  expect(dividers).toEqual(["a"])
  expect(dividers).not.toContain("d")
})

test("one project never folds to two dividers, however the store orders it", async () => {
  const tasks = [
    task("a1", { repo: "/work/api" }),
    task("b1", { repo: "/work/web" }),
    task("a2", { repo: "/work/api" }),
  ]
  seed({ a1: ["tab-1"], b1: ["tab-1"], a2: ["tab-1"] })
  expect(await railDividers(tasks)).toEqual(["a", "w"])
})

/* ── ctrl+<digit> ──────────────────────────────────────────────────────────
 *
 * `jump-digits.ts` promises ONE definition shared by the chord table, the key
 * handler and the row renderer: the number a row prints is the number that
 * jumps to it. The fold broke that promise in the loudest possible way — the
 * chord was registered inside the expanded tree, which folding UNMOUNTS, so
 * the default fold printed a digit on every row while `ctrl+2` did nothing at
 * all.
 *
 * The invariant restored below is per-surface, and deliberately so: the two
 * states do not draw the same rows, so a slot names a different row in each.
 * The cases after the render tests pin exactly where and why they diverge, so
 * a future change to either list has to come past a named expectation rather
 * than quietly shifting what a number means.
 */

/** `ctrl+<digit>` as a real terminal sends it (kitty CSI u: codepoint;5u).
 *  `pressKey("2", {ctrl:true})` cannot express it — the harness is in the
 *  legacy protocol, where a bare digit with ctrl has no encoding. */
function ctrlDigit(digit: string): string {
  return `\x1b[${digit.codePointAt(0)};5u`
}

const SETTLE = 90

async function foldedRail(tasks: readonly Task[]) {
  const groups = buildSidebarGroups({ tasks, tabsByTask: new Map() })
  const selected: string[] = []
  const entered: string[] = []
  const handle = await renderComponent(
    <box height={16} flexDirection="row">
      <CollapsedRail
        style="digits"
        groups={groups}
        selectedId={null}
        onSelect={(id) => selected.push(id)}
        onActivate={(id) => entered.push(id)}
        onExpand={() => {}}
      />
    </box>,
    { width: 8, height: 16 },
  )
  await new Promise((r) => setTimeout(r, SETTLE))
  return { ...handle, selected, entered, groups }
}

test("a folded row answers the digit it prints, and ENTERS the task", async () => {
  const tasks = [
    task("a1", { repo: "/work/api" }),
    task("b1", { repo: "/work/web" }),
    task("a2", { repo: "/work/api" }),
  ]
  seed({ a1: ["tab-1"], b1: ["tab-1"], a2: ["tab-1"] })
  const rail = await foldedRail(tasks)

  // Grouping reorders the store: the strip is a1, a2, b1.
  rail.mockInput.pressKeys([ctrlDigit("3")])
  await new Promise((r) => setTimeout(r, SETTLE))

  // Selecting alone would leave the chord meaning something weaker than it
  // does on the expanded side, where the jump enters the session.
  expect(rail.selected).toEqual(["a2"])
  expect(rail.entered).toEqual(["a2"])
})

test("every digit the fold prints reaches the row it is printed on", async () => {
  const tasks = [
    task("a1", { repo: "/work/api" }),
    task("b1", { repo: "/work/web" }),
    task("a2", { repo: "/work/api" }),
  ]
  seed({ a1: ["tab-1"], b1: ["tab-1"], a2: ["tab-1"] })
  const rail = await foldedRail(tasks)
  const ids = railJumpIds(rail.groups)

  // Read the digits off the FRAME rather than trusting the list: a strip that
  // printed them in another order would still satisfy a data-only check.
  const printed = (await rail.frame()).split("\n").flatMap((line) => {
    const glyph = line.trim().replace(/[▌\s]/g, "")
    return /^[0-9]$/.test(glyph) ? [glyph] : []
  })
  expect(printed).toEqual(ids.map((_, slot) => taskJumpDigit(slot) ?? ""))

  for (const [slot, digit] of printed.entries()) {
    rail.selected.length = 0
    rail.mockInput.pressKeys([ctrlDigit(digit)])
    await new Promise((r) => setTimeout(r, SETTLE))
    expect(rail.selected).toEqual([ids[slot] as string])
  }
})

test("a digit past the ninth row reaches nothing rather than the wrong row", () => {
  const ids = Array.from({ length: 12 }, (_, i) => `t${i}`)
  expect(jumpSlotTarget(ids, 8)).toBe("t8")
  // Row ten prints no digit (TASK_JUMP_DIGITS runs out), so nothing may reach it.
  expect(jumpSlotTarget(ids, 9)).toBeUndefined()
  expect(jumpSlotTarget(ids, -1)).toBeUndefined()
})

/* ── what a slot means in each state ───────────────────────────────────────
 *
 * The expanded tree numbers `treeFlatIds` — every navigable row. The fold
 * numbers `railJumpIds` — one per visible task. They agree exactly when the
 * tree has nothing but task rows, and the four cases below are every way they
 * come apart. None of these is fixable by the fold: they follow from the two
 * states drawing different rows, and closing them would mean changing what
 * `ctrl+2` already means in the expanded tree.
 */
const slots = (ids: readonly string[]) => ids.map((_, i) => jumpSlotTarget(ids, i))
const bothLists = (tasks: readonly Task[], tabs: Record<string, readonly string[]> = {}) => {
  const map = seed(tabs)
  return {
    tree: treeFlatIds(buildTreeRows({ tasks, tabsByTask: map })),
    fold: railJumpIds(buildSidebarGroups({ tasks, tabsByTask: map })),
  }
}

test("with nothing but task rows, a digit means the same task in both states", () => {
  const { tree, fold } = bothLists([task("a", { repo: "/work/api" }), task("b", { repo: "/work/web" })])
  expect(slots(fold)).toEqual(slots(tree))
})

test("tab rows take digits of their own, so the fold's slots run ahead", () => {
  const { tree, fold } = bothLists([task("a"), task("b")], { a: ["t1", "t2"] })
  expect(tree).toEqual(["a", "a::t1", "a::t2", "b"])
  expect(fold).toEqual(["a", "b"])
  // Same first row, and from there the numbers name different things — the
  // tree's `ctrl+3` opens a TAB of `a`, the fold's opens task `b`.
  expect(jumpSlotTarget(tree, 0)).toBe(jumpSlotTarget(fold, 0))
  expect(jumpSlotTarget(tree, 1)).toBe("a::t1")
  expect(jumpSlotTarget(fold, 1)).toBe("b")
})

test("a scratch session with tabs is a row the fold has and the tree does not", () => {
  // The tree hangs a scratch task's tabs straight under the section header and
  // emits no row for the task itself, so the fold's cell has no counterpart.
  const scratch = task("s", { kind: "dir", repo: "/tmp/s", scratch: true, worktreePath: "/tmp/s", branch: "" })
  const { tree, fold } = bothLists([scratch, task("a")], { s: ["t1"] })
  expect(tree).toEqual(["s::t1", "a"])
  expect(fold).toEqual(["s", "a"])
})

test("at rest a project's routines are one count row in the tree and real rows in the fold", () => {
  const routine = task("r1", { routine: { automationId: "nightly" } })
  const { tree, fold } = bothLists([task("own"), routine])
  // The tree's second slot is the fold toggle, which names no task at all.
  expect(jumpSlotTarget(tree, 1)).toBe("~routines:/work/api")
  expect(jumpSlotTarget(fold, 1)).toBe("r1")
})
