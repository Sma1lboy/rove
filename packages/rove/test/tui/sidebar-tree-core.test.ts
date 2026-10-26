import { describe, expect, test } from "vitest"
import {
  RECENT_ROW_ID,
  SCRATCH_SECTION_ID,
  type TreeTab,
  buildTreeRows,
  mainTaskIdOfProject,
  parseRowId,
  projectKeysOf,
  treeFlatIds,
  withRecentRow,
} from "../../src/tui/panes/sidebar/tree-core"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"

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

describe("buildTreeRows", () => {
  test("groups worktrees under one project header, main first", () => {
    const result = rows({
      tasks: [
        task("b", { branch: "feat/b" }),
        task("m", { kind: "main", repo: "/repos/rove", branch: "", worktreePath: "/repos/rove" }),
        task("a", { branch: "feat/a" }),
      ],
    })
    expect(result.map((r) => [r.kind, r.id])).toEqual([
      ["project", "/repos/rove"],
      // main is a worktree row, not the project row: the project is a repo,
      // the main checkout is a checkout, and only the latter carries tabs.
      ["worktree", "m"],
      ["worktree", "b"],
      ["worktree", "a"],
    ])
  })

  test("keeps projects in stored order rather than sorting them", () => {
    const result = rows({
      tasks: [task("z", { repo: "/repos/zebra" }), task("a", { repo: "/repos/apple" })],
    })
    expect(result.filter((r) => r.kind === "project").map((r) => r.id)).toEqual(["/repos/zebra", "/repos/apple"])
  })

  test("project order follows the MAINS' stored order, not first-seen task order", () => {
    // The move-mode contract: `moveTask` on a main swaps it among mains, so
    // the tree must key project order on main order — an older regular task
    // must not anchor its project ahead of the swap (that made project
    // move-mode read as a no-op).
    const result = rows({
      tasks: [
        task("old-z-task", { repo: "/repos/zebra" }),
        task("m-apple", { kind: "main", repo: "/repos/apple", worktreePath: "/repos/apple" }),
        task("m-zebra", { kind: "main", repo: "/repos/zebra", worktreePath: "/repos/zebra" }),
      ],
    })
    expect(result.filter((r) => r.kind === "project").map((r) => r.id)).toEqual(["/repos/apple", "/repos/zebra"])
  })

  test("a main-less project appends after the main-ordered ones", () => {
    const result = rows({
      tasks: [
        task("loose", { repo: "/repos/no-main" }),
        task("m", { kind: "main", repo: "/repos/rove", worktreePath: "/repos/rove" }),
      ],
    })
    expect(result.filter((r) => r.kind === "project").map((r) => r.id)).toEqual(["/repos/rove", "/repos/no-main"])
  })

  test("tabs never become rows — a task is one conversation", () => {
    // Engine, shell and content tabs live in the tab strip; the sidebar lists tasks only.
    const tabs = new Map([["a", [tab("tab-1"), tab("tab-2")]]])
    const result = rows({ tasks: [task("a")], tabsByTask: tabs })
    expect(result.map((r) => r.id)).toEqual(["/repos/rove", "a"])
  })

  test("a dir task groups under its directory as the project header", () => {
    // `rove .` on an arbitrary directory: loose rows
    // after the last project read as THAT project's rows, so the directory
    // itself is the header — same grouping rule as every other task.
    const result = rows({ tasks: [task("d", { kind: "dir", repo: "/tmp/scratch" })] })
    expect(result.map((r) => [r.kind, r.id])).toEqual([
      ["project", "/tmp/scratch"],
      ["worktree", "d"],
    ])
  })

  test("scratch tasks render in one Scratch section above every project", () => {
    const result = rows({
      tasks: [
        task("m", { kind: "main", repo: "/repos/rove", branch: "", worktreePath: "/repos/rove" }),
        task("s1", { kind: "dir", scratch: true, repo: "/Users/me" }),
        task("s2", { kind: "dir", scratch: true, repo: "/Users/me" }),
      ],
    })
    expect(result.map((r) => [r.kind, r.id])).toEqual([
      ["project", SCRATCH_SECTION_ID],
      ["worktree", "s1"],
      ["worktree", "s2"],
      ["project", "/repos/rove"],
      ["worktree", "m"],
    ])
  })

  test("a projectless routine's standing session folds into the No project routines row", () => {
    const result = rows({
      tasks: [
        task("s1", { kind: "dir", scratch: true, repo: "/Users/me" }),
        task("r1", {
          kind: "dir",
          noProject: true,
          repo: "/home/.rove/routines/a1",
          routine: { automationId: "a1" },
        }),
      ],
    })
    expect(result.map((r) => [r.kind, r.id])).toEqual([
      ["project", SCRATCH_SECTION_ID],
      ["worktree", "s1"],
      ["routines", `~routines:${SCRATCH_SECTION_ID}`],
    ])
  })

  test("a scratch task is one reachable row, whether or not it has tabs", () => {
    const result = rows({
      tasks: [
        task("s", { kind: "dir", scratch: true, repo: "/Users/me" }),
        task("m", { kind: "main", repo: "/repos/rove", branch: "", worktreePath: "/repos/rove" }),
      ],
      tabsByTask: new Map([["s", [tab("tab-1"), tab("tab-2")]]]),
    })
    expect(result.map((r) => [r.kind, r.id])).toEqual([
      ["project", SCRATCH_SECTION_ID],
      ["worktree", "s"],
      ["project", "/repos/rove"],
      ["worktree", "m"],
    ])
    expect(treeFlatIds(result)).toEqual(["s", "m"])
  })

  test("recent sort reorders regular worktrees newest-created first while keeping main first", () => {
    const result = rows({
      sortMode: "recent",
      tasks: [
        task("older", { repo: "/repos/rove", createdAt: "2026-08-01T00:00:00.000Z" }),
        task("m", { kind: "main", repo: "/repos/rove", branch: "", worktreePath: "/repos/rove" }),
        task("newer", { repo: "/repos/rove", createdAt: "2026-08-02T00:00:00.000Z" }),
      ],
    })
    expect(result.filter((r) => r.kind === "worktree").map((r) => r.id)).toEqual(["m", "newer", "older"])
  })

  test("name sort orders worktrees A→Z, case-blind and numbers by value, main still first", () => {
    const result = rows({
      sortMode: "name",
      tasks: [
        task("t10", { title: "task 10" }),
        task("m", { kind: "main", repo: "/repos/rove", branch: "", worktreePath: "/repos/rove", title: "zz main" }),
        task("beta", { title: "beta" }),
        task("t2", { title: "Task 2" }),
        task("alpha", { title: "Alpha" }),
      ],
    })
    expect(result.filter((r) => r.kind === "worktree").map((r) => r.id)).toEqual(["m", "alpha", "beta", "t2", "t10"])
  })

  test("attention sort floats blocked worktrees, then unread completions", () => {
    // All three touched at the SAME instant, so only the derived group can
    // order them — an age-only sort would leave the input order.
    const at = "2026-08-01T00:00:00.000Z"
    const result = rows({
      sortMode: "attention",
      activityOf: (id) => {
        const state = ({ quiet: "running", landed: "turn_complete", stuck: "permission_needed" } as const)[
          id as "quiet" | "landed" | "stuck"
        ]
        return state ? { state, at: Date.now() } : undefined
      },
      tasks: [task("quiet", { updatedAt: at }), task("landed", { updatedAt: at }), task("stuck", { updatedAt: at })],
    })
    expect(result.filter((r) => r.kind === "worktree").map((r) => r.id)).toEqual(["stuck", "landed", "quiet"])
  })

  test("attention sort keeps the main checkout first, like recent does", () => {
    const result = rows({
      sortMode: "attention",
      // An `error` must be 20s old to count as waiting on a person (the
      // derived group's debounce), so the fixture dates it past that.
      activityOf: (id) => (id === "stuck" ? { state: "error", at: Date.now() - 30_000 } : undefined),
      tasks: [
        task("quiet", { repo: "/repos/rove" }),
        task("m", { kind: "main", repo: "/repos/rove", branch: "", worktreePath: "/repos/rove" }),
        task("stuck", { repo: "/repos/rove" }),
      ],
    })
    expect(result.filter((r) => r.kind === "worktree").map((r) => r.id)).toEqual(["m", "stuck", "quiet"])
  })

  test("attention sort with no activity reader degrades to recency, not to a crash", () => {
    // A host that never passes `activityOf` (render tests, a pane mounted
    // before the daemon answers) must still produce a stable order.
    const result = rows({
      sortMode: "attention",
      tasks: [
        task("older", { updatedAt: "2026-08-01T00:00:00.000Z" }),
        task("newer", { updatedAt: "2026-08-02T00:00:00.000Z" }),
      ],
    })
    expect(result.filter((r) => r.kind === "worktree").map((r) => r.id)).toEqual(["newer", "older"])
  })

  test("a scratch task never mints a project header for its directory", () => {
    // Same dir, one scratch + one ordinary dir task: only the ordinary one
    // groups under the directory; the scratch row lives in Scratch.
    const result = rows({
      tasks: [task("s", { kind: "dir", scratch: true, repo: "/tmp/x" }), task("d", { kind: "dir", repo: "/tmp/x" })],
    })
    expect(result.map((r) => [r.kind, r.id])).toEqual([
      ["project", SCRATCH_SECTION_ID],
      ["worktree", "s"],
      ["project", "/tmp/x"],
      ["worktree", "d"],
    ])
  })
})

describe("treeFlatIds", () => {
  test("skips project headers so the cursor can never rest on one", () => {
    const result = rows({ tasks: [task("a")] })
    expect(treeFlatIds(result)).toEqual(["a"])
  })
})

describe("projectKeysOf", () => {
  test("first-seen order, deduped; a dir task contributes its directory", () => {
    expect(
      projectKeysOf([
        task("a", { repo: "/repos/rove" }),
        task("b", { repo: "/repos/foxychat" }),
        task("c", { repo: "/repos/rove" }),
        task("d", { kind: "dir", repo: "/tmp/scratch" }),
      ]),
    ).toEqual(["/repos/rove", "/repos/foxychat", "/tmp/scratch"])
  })
})

describe("mainTaskIdOfProject", () => {
  const tasks = [
    task("rove-wt", { repo: "/repos/rove" }),
    task("rove-main", { kind: "main", repo: "/repos/rove", branch: "main", worktreePath: "/repos/rove" }),
    task("fox-main", { kind: "main", repo: "/repos/foxychat", branch: "main", worktreePath: "/repos/foxychat" }),
  ]

  test("finds the repo's main checkout, not its first task", () => {
    // Project reorder rides on the MAIN row (mains move among mains), so
    // picking the first task of the repo would move nothing.
    expect(mainTaskIdOfProject(tasks, "/repos/rove")).toBe("rove-main")
    expect(mainTaskIdOfProject(tasks, "/repos/foxychat")).toBe("fox-main")
  })

  test("a project with no main checkout has nothing to move", () => {
    expect(mainTaskIdOfProject([task("only", { repo: "/repos/orphan" })], "/repos/orphan")).toBeNull()
  })

  test("an unknown project is null, not a throw", () => {
    expect(mainTaskIdOfProject(tasks, "/repos/nope")).toBeNull()
  })
})

// `tabRowActivity` is covered by the golden matrix
// (`test/golden/sidebar-row-state.golden.txt`, "which entry a TAB row may
// read"), which enumerates its whole truth table — tabActivity present/absent
// x reportedTabCount 0/1/2 x active — rather than a sample of it here.

describe("withRecentRow", () => {
  test("prepends a navigable recent row whose id no task can own", () => {
    const recent = task("b")
    const all = withRecentRow(rows({ tasks: [task("a"), recent], tabsByTask: new Map() }), recent)
    expect(all[0]).toMatchObject({ kind: "recent", id: RECENT_ROW_ID, task: recent })
    // The cursor can land on it: flatIds include it, first.
    expect(treeFlatIds(all)[0]).toBe(RECENT_ROW_ID)
    // parseRowId on the synthetic id yields a task id no ULID can be —
    // cursor chords that miss the special case fall through to a lookup miss.
    expect(parseRowId(RECENT_ROW_ID)).toEqual({ taskId: RECENT_ROW_ID, tabId: null })
  })

  test("no recent task = rows unchanged", () => {
    const base = rows({ tasks: [task("a")], tabsByTask: new Map() })
    expect(withRecentRow(base, null)).toEqual(base)
  })
})

describe("a project closed down to nothing", () => {
  const mainOf = (repo: string, id = "m") => task(id, { kind: "main", repo, title: repo.split("/").pop() ?? repo })

  test("a project's main stays listed once its tabs are closed — the project is remembered", () => {
    const out = rows({
      tasks: [mainOf("/repos/codefox")],
      // KNOWN and empty — the user closed the last tab, or ended the conversation.
      tabsByTask: new Map([["m", []]]),
    })
    expect(out.map((r) => r.kind)).toEqual(["project", "worktree"])
  })

  test("hides a closed-down `dir` row too — the same gesture on the same kind of row", () => {
    // A directory opened with `rove .` folds away like a project does. It has
    // no new-task-picker entry to come back through, and does not need one:
    // the way back is the same `rove .` that opened it. Leaving it on screen
    // made "close the last tab" mean two different things depending on a row
    // kind the user never chose.
    const dir = task("d", { kind: "dir", repo: "/Users/me/i/notes", branch: "", worktreePath: "/Users/me/i/notes" })
    expect(rows({ tasks: [dir], tabsByTask: new Map([["d", []]]) })).toEqual([])
  })

  test("still shows a `dir` row whose tabs are unknown", () => {
    // Same fresh-TUI carve-out the main rule has: absent ≠ empty.
    const dir = task("d", { kind: "dir", repo: "/Users/me/i/notes", branch: "", worktreePath: "/Users/me/i/notes" })
    expect(rows({ tasks: [dir], tabsByTask: new Map() }).map((r) => r.kind)).toEqual(["project", "worktree"])
  })

  test("still shows it when its tabs are merely UNKNOWN (fresh TUI)", () => {
    // Absent from the map = never mounted since restart, which is every
    // project on a cold boot. Hiding on that would make the sidebar start
    // empty — the difference this whole rule turns on.
    const out = rows({ tasks: [mainOf("/repos/codefox")], tabsByTask: new Map() })
    expect(out.map((r) => r.kind)).toEqual(["project", "worktree"])
  })

  test("still shows it while any tab is open", () => {
    const out = rows({
      tasks: [mainOf("/repos/codefox")],
      tabsByTask: new Map([["m", [tab("t1")]]]),
    })
    expect(out.map((r) => r.kind)).toEqual(["project", "worktree"])
  })

  test("keeps a project that has worktree tasks, even with every tab closed", () => {
    // The worktree rows are how you get back to that work — losing them would
    // strand the branches. Only the main-only case hides.
    const out = rows({
      tasks: [mainOf("/repos/rove"), task("a", { repo: "/repos/rove" })],
      tabsByTask: new Map([
        ["m", []],
        ["a", []],
      ]),
    })
    expect(out.map((r) => r.kind)).toEqual(["project", "worktree", "worktree"])
  })

  test("closing one project's tabs leaves every project listed", () => {
    const out = rows({
      tasks: [mainOf("/repos/codefox", "m1"), mainOf("/repos/rove", "m2")],
      tabsByTask: new Map([
        ["m1", []],
        ["m2", [tab("t1")]],
      ]),
    })
    expect(out.flatMap((r) => (r.kind === "project" ? [r.label] : []))).toEqual(["codefox", "rove"])
  })

  test("keeps a project whose ONLY row is a worktree task with no tabs", () => {
    // A main-less project (the tree supports these — "then main-less projects
    // in first-seen order"). Hiding it would strand the task: no main row
    // means nothing to re-open it from.
    const out = rows({
      tasks: [task("a", { repo: "/repos/orphan" })],
      tabsByTask: new Map([["a", []]]),
    })
    expect(out.map((r) => r.kind)).toEqual(["project", "worktree"])
  })

  test("a project whose main has no tabs is still navigable — its main row is the way back", () => {
    const out = rows({ tasks: [mainOf("/repos/codefox")], tabsByTask: new Map([["m", []]]) })
    expect(treeFlatIds(out).length).toBeGreaterThan(0)
  })

  /**
   * The optimistic half of `rove api delete`: the daemon accepts the request,
   * writes `deletion.phase = "queued"` and publishes that snapshot BEFORE it
   * enqueues the worktree teardown, so the row has to be gone from the tree by
   * the time the destroying starts. `error` is the correction — the worktree
   * survived, so the row has to come back to say so.
   */
  describe("in-flight deletions", () => {
    const deleting = (phase: "queued" | "running" | "error") => ({
      deletion: { phase, force: false, requestedAt: "2026-08-01T00:00:00.000Z" } as const,
    })

    test("drops a queued or running deletion", () => {
      const out = rows({
        tasks: [task("keep"), task("q", deleting("queued")), task("r", deleting("running"))],
        tabsByTask: new Map([
          ["keep", [tab("t1")]],
          ["q", [tab("t1")]],
          ["r", [tab("t1")]],
        ]),
      })
      expect(out.map((r) => r.id)).toEqual(["/repos/rove", "keep"])
    })

    test("keeps a failed deletion — the worktree is still there", () => {
      const out = rows({ tasks: [task("boom", deleting("error"))] })
      expect(out.map((r) => [r.kind, r.id])).toEqual([
        ["project", "/repos/rove"],
        ["worktree", "boom"],
      ])
    })

    test("a project whose only task is deleting goes with it", () => {
      expect(rows({ tasks: [task("only", deleting("running"))] })).toEqual([])
    })
  })
})
