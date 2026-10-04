import { describe, expect, test } from "vitest"
import {
  buildTreeRows,
  filterTreeRows,
  rowLiveBranchPath,
  worktreeRowLabel,
} from "../../src/tui/panes/sidebar/tree-core"
import type { TreeTab } from "../../src/tui/panes/sidebar/tree-core"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"

/**
 * What the tree's `/` search can FIND, and what its project headers are
 * CALLED — split from `sidebar-tree-core.test.ts` (file-size cap) because
 * both answer one question the shaping tests do not: at 25 tasks across 5
 * repos, does the rail still say which row is which?
 */

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

const tab = (id: string, label = id): TreeTab => ({ id, label })

function rows(over: Partial<Parameters<typeof buildTreeRows>[0]> = {}) {
  return buildTreeRows({
    tasks: [],
    tabsByTask: new Map(),
    ...over,
  })
}

describe("colliding project basenames (a 5-repo rail)", () => {
  test("two repos whose basename matches render DISTINGUISHABLE headers", () => {
    const result = rows({
      tasks: [
        task("w", { repo: "/Users/me/work/api", branch: "feat/w" }),
        task("o", { repo: "/Users/me/oss/api", branch: "feat/o" }),
      ],
    })
    const labels = result.filter((r) => r.kind === "project").map((r) => (r.kind === "project" ? r.label : ""))
    expect(labels).toEqual(["work/api", "oss/api"])
    // The actual defect: two headers reading as the same repo.
    expect(new Set(labels).size).toBe(labels.length)
  })

  test("a basename that collides with nothing stays the bare basename", () => {
    const result = rows({
      tasks: [task("a", { repo: "/Users/me/work/api" }), task("b", { repo: "/Users/me/oss/foxychat" })],
    })
    expect(result.filter((r) => r.kind === "project").map((r) => (r.kind === "project" ? r.label : ""))).toEqual([
      "api",
      "foxychat",
    ])
  })

  test("the disambiguated label is what search matches on", () => {
    const built = rows({
      tasks: [
        task("w", { repo: "/Users/me/work/api", branch: "feat/w" }),
        task("o", { repo: "/Users/me/oss/api", branch: "feat/o" }),
      ],
    })
    // "work/api" reaches only the work repo's subtree — with both headers
    // labelled bare `api` there was no query that could tell them apart.
    expect(filterTreeRows(built, "work/api").map((r) => r.id)).toEqual(["/Users/me/work/api", "w"])
  })
})

describe("filterTreeRows", () => {
  // One fixture for the whole block: two projects, a tab under each of the
  // kobe worktrees, so every ancestor/descendant direction has something to
  // prove.
  const tree = () =>
    rows({
      tasks: [
        task("m", { kind: "main", repo: "/repos/rove", branch: "main", worktreePath: "/repos/rove" }),
        task("wt", { repo: "/repos/rove", branch: "feat/tree", title: "worktree tree" }),
        task("fx", { repo: "/repos/foxychat", branch: "feat/chat", title: "chat rewrite" }),
      ],
      tabsByTask: new Map([
        ["m", [tab("tab-1", "shell")]],
        ["wt", [tab("tab-2", "running codex on the landing page")]],
        ["fx", [tab("tab-3", "vitest watch")]],
      ]),
    })

  const ids = (query: string) => filterTreeRows(tree(), query).map((r) => r.id)

  test("an empty query is a no-op", () => {
    expect(filterTreeRows(tree(), "   ")).toEqual(tree())
  })

  test("a tab hit keeps its worktree and project", () => {
    // The tree's whole increment over the flat sidebar: the query matches
    // nothing but a live tab TITLE, and the ancestors come along so the hit
    // is placed rather than floating.
    expect(ids("codex")).toEqual(["/repos/rove", "wt", "wt::tab-2"])
  })

  test("a worktree hit keeps its tabs", () => {
    expect(ids("feat/tree")).toEqual(["/repos/rove", "wt", "wt::tab-2"])
  })

  test("a project hit keeps the whole subtree", () => {
    expect(ids("foxychat")).toEqual(["/repos/foxychat", "fx", "fx::tab-3"])
  })

  test("no matches yields no rows — not a bare project header", () => {
    expect(ids("zzzz")).toEqual([])
  })

  test("a dir task's hit keeps its directory header", () => {
    const loose = rows({
      tasks: [task("d", { kind: "dir", repo: "/tmp/scratch", branch: "", title: "scratchpad" })],
      tabsByTask: new Map(),
    })
    expect(filterTreeRows(loose, "scratch").map((r) => r.id)).toEqual(["/tmp/scratch", "d"])
  })
})

describe("search finds exactly what the row displays (main + dir rows)", () => {
  // A `main` row stores NO branch: it is labelled by the live polled HEAD.
  const MAIN = task("m", {
    kind: "main",
    repo: "/Users/me/work/api",
    branch: "",
    worktreePath: "/Users/me/work/api",
    title: "api",
  })
  // A `dir` row is labelled by its tail-truncated PATH; its stored title is
  // deliberately ignored as auto-generated noise.
  // Nested deliberately: the row displays a tail-truncated PATH, so a segment
  // ABOVE the basename is visible on screen but absent from `repoBasename` —
  // matching on the basename alone would pass a weaker test by accident.
  const DIR = task("d", {
    kind: "dir",
    repo: "/Users/me/sandbox/scratchpad",
    branch: "",
    worktreePath: "/Users/me/sandbox/scratchpad",
    title: "jacksonc-ab3x",
  })
  const liveBranch = (t: Task) => (rowLiveBranchPath(t) === "/Users/me/work/api" ? "release/2026-09" : "")

  const built = () => rows({ tasks: [MAIN, DIR], tabsByTask: new Map() })

  test("a main row is findable by the live branch name printed on it", () => {
    // Precondition: that branch name really IS the row's rendered label.
    expect(worktreeRowLabel(MAIN, { liveBranch: "release/2026-09" })).toBe("release/2026-09")
    expect(filterTreeRows(built(), "release/2026-09", liveBranch).map((r) => r.id)).toEqual(["/Users/me/work/api", "m"])
  })

  test("a dir row is findable by the path it displays", () => {
    expect(worktreeRowLabel(DIR, { home: "/Users/me" })).toBe("~/sandbox/scratchpad")
    expect(filterTreeRows(built(), "sandbox/scratchpad", liveBranch).map((r) => r.id)).toEqual([
      "/Users/me/sandbox/scratchpad",
      "d",
    ])
  })

  test("a dir row's ignored auto-generated title is not findable either", () => {
    // Searchable must equal visible in BOTH directions: the row never shows
    // `jacksonc-ab3x`, so a query for it must not silently land on this row.
    expect(worktreeRowLabel(DIR, { home: "/Users/me" })).not.toContain("jacksonc")
    expect(filterTreeRows(built(), "jacksonc-ab3x", liveBranch)).toEqual([])
  })

  test("a query cannot straddle two fields of the same row", () => {
    // `fuzzyMatch` is a subsequence test, so matching the JOINED fields lets
    // a query spend its first half on the branch and its second on the title
    // — the row then matches text it never shows together anywhere.
    const built = rows({ tasks: [task("fx", { branch: "feat/chat", title: "tree rewrite" })] })
    expect(filterTreeRows(built, "feat/tree")).toEqual([])
  })

  test("a regular task keeps matching on its branch, title and repo", () => {
    const built = rows({ tasks: [task("wt", { branch: "feat/tree", title: "worktree tree" })] })
    expect(filterTreeRows(built, "feat/tree").map((r) => r.id)).toEqual(["/repos/rove", "wt"])
    expect(filterTreeRows(built, "worktree tree").map((r) => r.id)).toEqual(["/repos/rove", "wt"])
    expect(filterTreeRows(built, "rove").map((r) => r.id)).toEqual(["/repos/rove", "wt"])
  })
})
