import { describe, expect, test } from "bun:test"
import type { RowStatus, TaskRow } from "rove-bridge/protocol"
import { displayLine, noteRange, parseUnifiedDiff } from "../src/diff.ts"
import { dotLevels, dotsMove } from "../src/dot-levels.ts"
import { visibleTree } from "../src/file-tree.ts"
import { en, zh } from "../src/i18n/index.ts"
import { compactAge, inboxBadge, isRoutineState, nextAttention } from "../src/inbox.ts"
import { prEntries, prRepo } from "../src/pr-chip.tsx"
import { leadPrMark, needsPerson, prMark, sessionPrMark, statusMark } from "../src/rail-glyphs.ts"
import { groupByProject, navRows } from "../src/rail.ts"
import { tokenFromInput } from "../src/token-input.ts"

const TOKEN = "a".repeat(43)

describe("pasted link", () => {
  test("takes the token from a full link, a bare token, or neither", () => {
    expect(tokenFromInput(` http://127.0.0.1:7878/#token=${TOKEN} `)).toBe(TOKEN)
    expect(tokenFromInput(TOKEN)).toBe(TOKEN)
    // The phone pairing URL carries the token in the query, which the page never reads.
    expect(tokenFromInput(`ws://127.0.0.1:7878/?token=${TOKEN}`)).toBeNull()
    expect(tokenFromInput("http://127.0.0.1:7878/#token=short")).toBeNull()
  })
})

function leaves(tree: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(tree as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === "string") out[path] = value
    else Object.assign(out, leaves(value, path))
  }
  return out
}

test("zh carries every en key, non-empty, with the same placeholders", () => {
  const e = leaves(en)
  const z = leaves(zh)
  expect(Object.keys(z).sort()).toEqual(Object.keys(e).sort())
  const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join()
  for (const key of Object.keys(e)) {
    expect(z[key].trim().length).toBeGreaterThan(0)
    expect(holes(z[key])).toBe(holes(e[key]))
  }
})

function row(id: string, repo: string, order: number): TaskRow {
  return {
    id,
    title: id,
    branch: "",
    repo,
    kind: "managed",
    status: "backlog",
    group: "idle",
    rank: 0,
    activity: null,
    engine: null,
    pr: null,
    report: null,
    deleting: false,
    order,
  }
}

describe("rail", () => {
  test("groups by project in the daemon's manual order, projects by their first task", () => {
    const groups = groupByProject([row("b1", "/w/beta", 2), row("a1", "/w/alpha", 1), row("b0", "/w/beta", 0)])
    expect(groups.map((g) => [g.label, g.tasks.map((t) => t.id)])).toEqual([
      ["beta", ["b0", "b1"]],
      ["alpha", ["a1"]],
    ])
  })

  test("a sort reorders tasks but the project's main checkout stays first", () => {
    const main = { ...row("m", "/w/a", 3), kind: "main", title: "zzz" }
    const tasks = [
      main,
      { ...row("x", "/w/a", 0), title: "beta", rank: 1 },
      { ...row("y", "/w/a", 1), title: "alpha", rank: 0 },
    ]
    expect(groupByProject(tasks, "name")[0].tasks.map((t) => t.id)).toEqual(["m", "y", "x"])
    expect(groupByProject(tasks, "attention")[0].tasks.map((t) => t.id)).toEqual(["m", "y", "x"])
    expect(groupByProject(tasks, "default")[0].tasks.map((t) => t.id)).toEqual(["m", "x", "y"])
  })

  test("`/` keeps a hit's ancestors: a task hit keeps its children, a child hit keeps its parent", () => {
    const groups = groupByProject([
      { ...row("t1", "/w/a", 0), title: "Fix retry" },
      { ...row("c1", "/w/a", 1), title: "claude", parentTaskId: "t1" },
      { ...row("t2", "/w/a", 2), title: "Audit" },
      { ...row("c2", "/w/a", 3), title: "vitest", parentTaskId: "t2" },
    ])
    const ids = (q: string) => navRows(groups, q).map((r) => r.id)
    expect(ids("retry")).toEqual(["project:/w/a", "t1", "c1"])
    expect(ids("vitest")).toEqual(["project:/w/a", "t2", "c2"])
    expect(ids("nomatch")).toEqual([])
  })
})

const st = (kind: RowStatus["kind"], reason?: RowStatus["reason"]): RowStatus => ({
  kind,
  since: 1,
  ...(reason ? { reason } : {}),
})

describe("row status marks (the daemon's, through row-status-glyph)", () => {
  const rowWith = (rollup: RowStatus | undefined) => ({ id: "t", rowStatus: rollup }) as unknown as TaskRow

  test("each status draws its dot look in the colour ELYTerminal gives it", () => {
    expect(statusMark(st("running"))).toEqual({ look: "working", tone: "info" })
    expect(statusMark({ kind: "busy", reason: "deleting", since: 1 })).toEqual({ look: "working", tone: "info" })
    expect(statusMark(st("needs-input"))).toEqual({ look: "waiting", tone: "warning" })
    // A rate limit clears itself: an amber wait. An error stays until you act: a red X.
    expect(statusMark(st("attention", "rate_limited"))).toEqual({ look: "waiting", tone: "warning" })
    expect(statusMark(st("attention", "error"))).toEqual({ look: "error", tone: "attention" })
    expect(statusMark(st("attention", "dead"))).toEqual({ look: "error", tone: "attention" })
    expect(statusMark(st("unseen"))).toEqual({ look: "done", tone: "success" })
    expect(statusMark(st("idle"))).toEqual({ look: "idle", tone: "muted" })
    // No reading yet is a quiet row.
    expect(statusMark(undefined)).toEqual({ look: "idle", tone: "muted" })
  })

  test("a fold counts rows that need a person", () => {
    const rows = [st("needs-input"), st("attention", "rate_limited"), st("unseen"), st("running"), undefined]
    expect(rows.map((s) => needsPerson(rowWith(s)))).toEqual([true, true, false, false, false])
  })
})

describe("status dots (ELYTerminal's orb)", () => {
  const peak = (dot: number) => {
    const steps = Array.from({ length: 15 }, (_, step) => step)
    return steps.reduce((best, step) =>
      dotLevels("working", step, 0)[dot] > dotLevels("working", best, 0)[dot] ? step : best,
    )
  }

  test("work ripples from the centre to the edges, then the corners, once per 15 steps", () => {
    expect(peak(4)).toBe(0)
    expect(peak(4)).toBeLessThan(peak(1))
    expect(peak(1)).toBeLessThan(peak(0))
    expect([3, 5, 7].map(peak)).toEqual([peak(1), peak(1), peak(1)])
    expect([2, 6, 8].map(peak)).toEqual([peak(0), peak(0), peak(0)])
    dotLevels("working", 0, 0).forEach((level, dot) => expect(dotLevels("working", 15, 0)[dot]).toBeCloseTo(level, 6))
  })

  test("a slowed ripple still moves", () => {
    expect(dotLevels("working", 0, 0, 3)).not.toEqual(dotLevels("working", 5, 0, 3))
  })

  test("waiting stays lit and dips on steps 0, 1, 4 and 5 of 20", () => {
    const dips = Array.from({ length: 20 }, (_, step) => step).filter((step) => dotLevels("waiting", step, 0)[0] < 1)
    expect(dips).toEqual([0, 1, 4, 5])
    expect(dotLevels("waiting", 2, 0)).toEqual(new Array(9).fill(1))
    expect(dotLevels("waiting", 0, 0)).toEqual(new Array(9).fill(0.25))
  })

  test("a settled look draws its shape dot by dot, then holds", () => {
    expect(dotLevels("done", 0, 0)).toEqual(new Array(9).fill(0.12))
    const one = dotLevels("done", 0, 1)
    expect(one[3]).toBeGreaterThan(0.12)
    expect(one[2]).toBe(0.12)
    const drawn = dotLevels("done", 0, 5)
    expect([3, 7, 5, 2].map((dot) => drawn[dot])).toEqual([1, 1, 1, 1])
    expect(dotLevels("done", 0, 500)).toEqual(drawn)
    expect(dotsMove("done", 4)).toBe(true)
    expect(dotsMove("done", 5)).toBe(false)
    const idle = dotLevels("idle", 0, 9)
    expect(idle[4]).toBe(0.12)
    expect([1, 2, 5, 8, 7, 6, 3, 0].map((dot) => idle[dot])).toEqual(new Array(8).fill(0.6))
    expect(dotsMove("working", 1_000_000) && dotsMove("waiting", 1_000_000)).toBe(true)
  })
})

describe("inbox", () => {
  test("tells a rate limit, a dead engine, a question and a finished turn apart, like the TUI", () => {
    const glyphs = ["rate_limited", "dead", "permission_needed", "turn_complete", "error"].map(
      (s) => inboxBadge(s).glyph,
    )
    expect(new Set(glyphs).size).toBe(glyphs.length)
    expect(inboxBadge("permission_needed").stateKey).toBe("inbox.state.needsInput")
  })

  test("ages compactly across unit boundaries", () => {
    expect(compactAge(59_000)).toBe("59s")
    expect(compactAge(60_000)).toBe("1m")
    expect(compactAge(3 * 3_600_000)).toBe("3h")
    expect(compactAge(72 * 3_600_000)).toBe("3d")
  })
})

describe("diff", () => {
  const text = [
    "diff --git a/src/x.ts b/src/x.ts",
    "index 1..2 100644",
    "--- a/src/x.ts",
    "+++ b/src/x.ts",
    "@@ -10,3 +10,3 @@",
    " keep",
    "-old",
    "+new",
    " tail",
  ].join("\n")

  test("gutter numbers follow the hunk header; a note anchors to the number the row shows", () => {
    const rows = parseUnifiedDiff(text)
    const body = rows.filter((r) => r.kind === "ctx" || r.kind === "add" || r.kind === "del")
    expect(body.map((r) => [r.kind, displayLine(r), r.path])).toEqual([
      ["ctx", 10, "src/x.ts"],
      ["del", 11, "src/x.ts"],
      ["add", 11, "src/x.ts"],
      ["ctx", 12, "src/x.ts"],
    ])
    expect(rows.filter((r) => r.kind === "meta" || r.kind === "hunk").every((r) => displayLine(r) === null)).toBe(true)
  })

  test("a v-range spans its two ends in either direction; a header row anchors nothing", () => {
    const rows = parseUnifiedDiff(text)
    const first = rows.findIndex((r) => r.kind === "ctx")
    const last = rows.length - 1
    expect(noteRange(rows, last, first)).toEqual({ path: "src/x.ts", startLine: 10, line: 12 })
    expect(noteRange(rows, first, last)).toEqual({ path: "src/x.ts", startLine: 10, line: 12 })
    expect(noteRange(rows, 0, null)).toBeNull()
  })
})

test("file tree: dirs first, only expanded dirs show children, dir paths end in /", () => {
  const files = ["b.txt", "src/a.ts", "src/lib/c.ts", "a.md"]
  expect(visibleTree(files, new Set()).map((r) => r.path)).toEqual(["src/", "a.md", "b.txt"])
  expect(visibleTree(files, new Set(["src/"])).map((r) => [r.path, r.depth])).toEqual([
    ["src/", 0],
    ["src/lib/", 1],
    ["src/a.ts", 1],
    ["a.md", 0],
    ["b.txt", 0],
  ])
})

describe("F7 next attention", () => {
  const row = (taskId: string, state: string, at: number) => ({ taskId, tabId: "tab-1", state, unread: true, at })
  const rows = [row("done", "turn_complete", 1), row("old", "permission_needed", 5), row("new", "error", 9)]
  const order = ["done", "old", "new"]
  test("blocked episodes first, oldest first; then cycles past the one being viewed", () => {
    expect(nextAttention(rows, order, { taskId: null, tabId: null })?.taskId).toBe("old")
    expect(nextAttention(rows, order, { taskId: "old", tabId: "tab-1" })?.taskId).toBe("new")
    expect(nextAttention(rows, order, { taskId: "done", tabId: "tab-1" })?.taskId).toBe("old")
  })
  test("an episode whose task is gone is skipped", () => {
    expect(nextAttention([row("gone", "error", 1)], order, { taskId: null, tabId: null })).toBeNull()
  })
  test("a routine episode has no task but stays eligible, and its states open the Routines page", () => {
    const routine = { taskId: null, tabId: null, state: "routine_failed", unread: true, at: 3, automationId: "r-1" }
    const next = nextAttention([routine], order, { taskId: null, tabId: null })
    expect(next?.automationId).toBe("r-1")
    expect(isRoutineState("routine_failed")).toBe(true)
    expect(isRoutineState("error") || isRoutineState("turn_complete")).toBe(false)
  })
})

describe("a task's PR mark", () => {
  const withPr = (lifecycle: string, prChip: TaskRow["prChip"] = null, extra: Partial<TaskRow> = {}) =>
    ({ pr: { number: 7, lifecycle, checkState: "none" }, prChip, ...extra }) as unknown as TaskRow

  test("merged and closed PRs keep their own icon instead of disappearing", () => {
    expect(prMark(withPr("merged"))).toMatchObject({ state: "merged", tone: "text-merged" })
    expect(prMark(withPr("closed"))).toMatchObject({ state: "closed", tone: "text-muted" })
    expect(prMark(withPr("merged"))?.glyph).not.toBe(prMark(withPr("open"))?.glyph)
  })

  test("an open PR is red while it can't land, green when checks pass, grey when the forge was unreachable", () => {
    expect(prMark(withPr("open", "conflict"))).toMatchObject({ tone: "text-error", checks: "conflict" })
    expect(prMark(withPr("ready_to_merge", "failing"))).toMatchObject({ tone: "text-error", checks: "failing" })
    expect(prMark(withPr("open", "passing"))).toMatchObject({ tone: "text-success", checks: "passing" })
    expect(prMark(withPr("open", "passing", { prChipStale: true }))?.tone).toBe("text-muted")
  })

  test("no PR, or one still being created, draws nothing", () => {
    expect(prMark({ pr: null } as unknown as TaskRow)).toBeNull()
    expect(prMark(withPr("creating"))).toBeNull()
  })

  test("a row with several PRs leads with the one that needs you, then open, merged, closed", () => {
    const marks = (...rows: TaskRow[]) => rows.flatMap((row) => prMark(row) ?? [])
    const merged = withPr("merged", null, { prChipStale: true })
    expect(leadPrMark(marks(withPr("closed"), merged, withPr("open", "passing")))?.state).toBe("open")
    expect(leadPrMark(marks(withPr("open", "passing"), withPr("open", "conflict")))?.checks).toBe("conflict")
    expect(leadPrMark(marks(withPr("closed"), merged))?.state).toBe("merged")
    expect(leadPrMark([])).toBeUndefined()
  })

  test("the hover list names a PR's repo from its URL", () => {
    expect(prRepo("https://github.com/Sma1lboy/rove/pull/1431")).toBe("Sma1lboy/rove")
    expect(prRepo("https://example.com/not/a/pr")).toBeUndefined()
    expect(prRepo(undefined)).toBeUndefined()
  })

  test("a child on its parent's branch adds no second copy of the same PR", () => {
    const pr = (number: number) => ({
      number,
      lifecycle: "merged",
      checkState: "none",
      url: `https://github.com/o/r/pull/${number}`,
    })
    const parent = { id: "p", repo: "/r", pr: pr(1437) } as unknown as TaskRow
    const shared = { id: "s", repo: "/r", pr: pr(1437) } as unknown as TaskRow
    const own = { id: "c", repo: "/r", pr: pr(1436) } as unknown as TaskRow
    expect(prEntries([parent, shared, own]).map((entry) => entry.task.id)).toEqual(["p", "c"])
  })

  test("a duplicated PR keeps the copy whose checks need you", () => {
    const pr = { number: 9, lifecycle: "open", checkState: "none", url: "https://github.com/o/r/pull/9" }
    const parent = { id: "p", repo: "/r", pr, prChip: "passing" } as unknown as TaskRow
    const child = { id: "c", repo: "/r", pr, prChip: "failing" } as unknown as TaskRow
    expect(prEntries([parent, child]).map((entry) => [entry.task.id, entry.mark.checks])).toEqual([["c", "failing"]])
  })

  test("a main task's session PRs list beside a child's, one entry per URL", () => {
    const url = (n: number) => `https://github.com/o/r/pull/${n}`
    const main = {
      id: "m",
      repo: "/r",
      pr: null,
      sessionPrs: [
        { number: 1, url: url(1), lifecycle: "merged", checkState: "none" },
        { number: 2, url: url(2), lifecycle: "unknown", checkState: "unknown" },
      ],
    } as unknown as TaskRow
    const child = {
      id: "c",
      repo: "/r",
      pr: { number: 2, url: url(2), lifecycle: "open", checkState: "passing" },
      prChip: "passing",
    } as unknown as TaskRow
    const entries = prEntries([main, child])
    expect(entries.map((entry) => entry.pr.url)).toEqual([url(1), url(2)])
    expect(entries.map((entry) => entry.mark.state)).toEqual(["merged", "open"])
    expect(entries[1]?.mark.checks).toBe("passing")
  })

  test("an unpolled session PR draws as an open one with no check state", () => {
    const mark = sessionPrMark({ lifecycle: "unknown", checkState: "unknown", url: "https://github.com/o/r/pull/5" })
    expect(mark).toMatchObject({ state: "open", tone: "text-muted" })
    expect(mark?.checks).toBeUndefined()
  })
})
