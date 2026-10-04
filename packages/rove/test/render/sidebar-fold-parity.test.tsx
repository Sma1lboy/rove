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
import { type TreeTab, buildTreeRows } from "../../src/tui/panes/sidebar/tree-core"
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
      <CollapsedRail style="glyphs" groups={groups} selectedId={null} onSelect={() => {}} onExpand={() => {}} />
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
 *  the header it prints, which is all a narrow fold has room for. */
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

test("the fold draws no cell for a routine session", async () => {
  const routine = task("r1", { repo: "/work/api", routine: { automationId: "nightly" } })
  seed({})
  const { frame } = await renderComponent(<FoldedRail tasks={[task("own", { repo: "/work/api" }), routine]} />, {
    width: 8,
    height: 16,
  })
  const text = await frame()
  // One project, one drawn row: the divider plus a single status glyph.
  expect(dividersOf(text)).toEqual(["a"])
  const rows = text.split("\n").filter((line) => line.trim().length > 0 && !line.includes("─") && !line.includes("››"))
  expect(rows).toHaveLength(1)
})
