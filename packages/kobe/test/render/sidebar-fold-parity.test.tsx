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
import { CollapsedRail } from "../../src/tui-react/panes/sidebar/collapsed-rail"
import { useSidebarGroups } from "../../src/tui-react/panes/sidebar/use-sidebar-groups"
import { tabsByTask as tabStore } from "../../src/tui-react/workspace/terminal-tabs-shared"
import { jumpSlotTarget, taskJumpDigit } from "../../src/tui/panes/sidebar/jump-digits"
import { buildSidebarGroups, jumpTaskIds } from "../../src/tui/panes/sidebar/project-groups"
import {
  type TreeTab,
  buildTreeRows,
  filterTreeRows,
  jumpRowsOf,
  parseRowId,
  withRecentRow,
} from "../../src/tui/panes/sidebar/tree-core"
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
  const ids: readonly string[] = jumpTaskIds(rail.groups)

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
 * The digit is anchored on the GROUPS — `jumpTaskIds`, the answer both
 * surfaces already share — not on either one's rendered rows. Anchoring it on
 * rows is what used to make `ctrl+3` name a different session once you folded
 * the rail: the tree draws a row per tab as well as per task, the fold draws
 * one cell per task, so the same slot counted past different things.
 *
 * Every case below is one that used to diverge. What varies now is only which
 * ROW wears the number, which is presentation and is allowed to differ.
 */
const treeJumpTasks = (
  tasks: readonly Task[],
  tabs: ReadonlyMap<string, readonly TreeTab[]>,
  groups: ReturnType<typeof buildSidebarGroups>,
) =>
  jumpRowsOf(buildTreeRows({ tasks, tabsByTask: tabs }), new Set(jumpTaskIds(groups))).map(
    (rowId) => parseRowId(rowId).taskId,
  )

function bothStates(tasks: readonly Task[], tabSpec: Record<string, readonly string[]> = {}) {
  const tabs = seed(tabSpec)
  const groups = buildSidebarGroups({ tasks, tabsByTask: tabs })
  return { fold: jumpTaskIds(groups), tree: treeJumpTasks(tasks, tabs, groups), groups, tabs }
}

test("a digit names the same task folded and unfolded — plain rows", () => {
  const { tree, fold } = bothStates([task("a", { repo: "/work/api" }), task("b", { repo: "/work/web" })])
  expect(tree).toEqual(fold)
  expect(fold).toEqual(["a", "b"])
})

test("a task's tab rows no longer take digits of their own", () => {
  // The tree still DRAWS them; they just carry no number, so the second digit
  // is the second task in both states rather than the first task's first tab.
  const { tree, fold } = bothStates([task("a"), task("b")], { a: ["t1", "t2"] })
  expect(tree).toEqual(fold)
  expect(jumpSlotTarget(fold, 1)).toBe("b")
})

test("a scratch session with tabs is reached by the same digit, on a different row", () => {
  // It has no worktree row — its tabs hang straight under the section header —
  // so the tree prints the digit on its first TAB row. Same task either way.
  const scratch = task("s", { kind: "dir", repo: "/tmp/s", scratch: true, worktreePath: "/tmp/s", branch: "" })
  const { tree, fold, groups, tabs } = bothStates([scratch, task("a")], { s: ["t1"] })
  expect(tree).toEqual(fold)
  expect(
    jumpRowsOf(buildTreeRows({ tasks: [scratch, task("a")], tabsByTask: tabs }), new Set(jumpTaskIds(groups))),
  ).toEqual(["s::t1", "a"])
})

test("routine sessions take no digit in either state", () => {
  // As many of them as their schedule has fired; letting them take slots would
  // push the tasks a person opened past the ninth, the last one with a digit.
  const routine = task("r1", { routine: { automationId: "nightly" } })
  const { tree, fold } = bothStates([task("own"), routine])
  expect(tree).toEqual(fold)
  expect(fold).toEqual(["own"])
})

test("the recent-jump row does not shift every digit behind it", () => {
  // Narrow mode prepends a second appearance of a task that already has a row.
  // While digits counted rows, it took slot one and moved everything down.
  const tasks = [task("a"), task("b")]
  const tabs = seed({})
  const groups = buildSidebarGroups({ tasks, tabsByTask: tabs })
  const withRecent = withRecentRow(buildTreeRows({ tasks, tabsByTask: tabs }), tasks[0] as Task)
  expect(jumpRowsOf(withRecent, new Set(jumpTaskIds(groups)))).toEqual(["a", "b"])
})

test("a query renumbers the tree's digits down the rows that survived it", () => {
  // Search is the one mode with no folded counterpart to disagree with, and
  // renumbering is the point: you read the number off the row.
  const tasks = [task("alpha"), task("beta"), task("gamma")]
  const tabs = seed({})
  const groups = buildSidebarGroups({ tasks, tabsByTask: tabs })
  const pruned = filterTreeRows(buildTreeRows({ tasks, tabsByTask: tabs }), "gamma", () => "")
  expect(jumpRowsOf(pruned, new Set(jumpTaskIds(groups)))).toEqual(["gamma"])
})

test("the fold draws no cell for a routine session", async () => {
  const routine = task("r1", { repo: "/work/api", routine: { automationId: "nightly" } })
  seed({})
  const rail = await foldedRail([task("own", { repo: "/work/api" }), routine])
  const frame = await rail.frame()
  // One project, one drawn row: the divider plus a single digit.
  expect(dividersOf(frame)).toEqual(["a"])
  expect(frame.split("\n").filter((line) => /[0-9]/.test(line))).toHaveLength(1)
})
