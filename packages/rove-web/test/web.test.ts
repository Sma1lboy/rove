import { describe, expect, test } from "bun:test"
import type { RowStatus, TaskRow } from "rove-bridge/protocol"
import { displayLine, noteRange, parseUnifiedDiff } from "../src/diff.ts"
import { visibleTree } from "../src/file-tree.ts"
import { en } from "../src/i18n/en.ts"
import { zh } from "../src/i18n/zh.ts"
import { compactAge, inboxBadge, isRoutineState, nextAttention } from "../src/inbox.ts"
import { anySpinning, groupByProject, navRows, needsPerson, statusGlyph, taskRowGlyph } from "../src/rail.ts"
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

  test("uses the TUI's glyphs: ? waits on you, ! needs you, ● unseen turn, ○ quiet", () => {
    expect(statusGlyph(st("needs-input"), 0).glyph).toBe("?")
    for (const reason of ["rate_limited", "error", "dead", "restored"] as const)
      expect(statusGlyph(st("attention", reason), 0).glyph).toBe("!")
    expect(statusGlyph(st("unseen"), 0).glyph).toBe("●")
    expect(statusGlyph(undefined, 0).glyph).toBe("○")
    expect(statusGlyph(st("running"), 0).glyph).not.toBe(statusGlyph(st("running"), 1).glyph)
  })
})

const st = (kind: RowStatus["kind"], reason?: RowStatus["reason"]): RowStatus => ({
  kind,
  since: 1,
  ...(reason ? { reason } : {}),
})

describe("row status marks (the daemon's, through row-status-glyph)", () => {
  const rowWith = (rollup: RowStatus | undefined) => ({ id: "t", rowStatus: rollup }) as unknown as TaskRow

  test("a task row draws the rollup of its one conversation, in the tone of its kind", () => {
    const mark = (status: RowStatus | undefined) => taskRowGlyph(rowWith(status), 0)
    expect(mark(st("running"))).toMatchObject({ tone: "accent", spinning: true })
    expect(mark(st("needs-input"))).toEqual({ glyph: "?", tone: "warning", spinning: false })
    // A rate limit clears itself: amber. An error stays until you act: red.
    expect(mark(st("attention", "rate_limited"))).toEqual({ glyph: "!", tone: "warning", spinning: false })
    expect(mark(st("attention", "error"))).toEqual({ glyph: "!", tone: "attention", spinning: false })
    expect(mark(st("attention", "dead"))).toEqual({ glyph: "!", tone: "attention", spinning: false })
    expect(mark(st("unseen"))).toEqual({ glyph: "●", tone: "accent", spinning: false })
    expect(mark(st("idle"))).toEqual({ glyph: "○", tone: "muted", spinning: false })
    // No reading yet is a quiet row.
    expect(mark(undefined)).toEqual({ glyph: "○", tone: "muted", spinning: false })
    expect(mark({ kind: "busy", reason: "deleting", since: 1 })).toMatchObject({ tone: "accent", spinning: true })
  })

  test("the spinner ticks for a running or busy row; a fold counts rows that need a person", () => {
    expect(anySpinning([rowWith(st("running"))])).toBe(true)
    expect(anySpinning([rowWith({ kind: "busy", reason: "job", since: 1 })])).toBe(true)
    expect(anySpinning([rowWith(st("unseen"))])).toBe(false)
    const rows = [st("needs-input"), st("attention", "rate_limited"), st("unseen"), st("running"), undefined]
    expect(rows.map((s) => needsPerson(rowWith(s)))).toEqual([true, true, false, false, false])
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
    expect(isRoutineState("routine_failed") && isRoutineState("routine_responded")).toBe(true)
    expect(isRoutineState("error") || isRoutineState("turn_complete")).toBe(false)
  })
})
