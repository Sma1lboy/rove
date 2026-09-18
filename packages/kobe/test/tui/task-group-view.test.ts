/**
 * Presentation of the derived task group: which marker a row draws, which
 * word a board badge shows, and the `attention` sort's ranking.
 *
 * The derivation itself is tested in `test/lib/task-group.test.ts`; this pins
 * the half the two surfaces share, so the rail and the board cannot disagree
 * about what `waiting-on-you` looks like.
 */

import { describe, expect, it } from "vitest"
import { TASK_GROUPS } from "../../src/lib/task-group.ts"
import { ATTENTION_GLYPH } from "../../src/tui/panes/sidebar/row-view.ts"
import {
  compareTaskGroup,
  taskGroupGlyph,
  taskGroupIn,
  taskGroupLabel,
  taskGroupTone,
} from "../../src/tui/panes/sidebar/task-group-view.ts"
import { type Task, toTaskId } from "../../src/types/task.ts"

const NOW = 1_800_000_000_000

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id: toTaskId(id),
    title: id,
    repo: "/repo",
    branch: `fix/${id}`,
    worktreePath: `/wt/${id}`,
    status: "in_progress",
    createdAt: new Date(NOW - 7_200_000).toISOString(),
    updatedAt: new Date(NOW - 3_600_000).toISOString(),
    ...over,
  }
}

describe("taskGroupIn", () => {
  it("reads a pane's activity entry straight through", () => {
    expect(taskGroupIn(task("t"), { state: "running", at: NOW }, NOW)).toBe("working")
  })

  it("answers unknown when a pane has no entry — never idle", () => {
    // A pane holds the daemon's activity map, not the pty host's inventory,
    // so it cannot prove a task is resting.
    expect(taskGroupIn(task("t"), undefined, NOW)).toBe("unknown")
  })
})

describe("taskGroupGlyph", () => {
  it("reuses the rail's existing needs-you and turn-landed glyphs", () => {
    expect(taskGroupGlyph("waiting-on-you")).toEqual({ glyph: ATTENTION_GLYPH, tone: "error" })
    expect(taskGroupGlyph("ready-for-review")).toEqual({ glyph: "●", tone: "primary" })
  })

  it("gives `landing` the one marker the rail could not express", () => {
    expect(taskGroupGlyph("landing")).toEqual({ glyph: "»", tone: "success" })
  })

  it("draws nothing for the groups with nothing to do — `working` included, since the spinner owns it", () => {
    expect(taskGroupGlyph("working")).toBeNull()
    expect(taskGroupGlyph("idle")).toBeNull()
    expect(taskGroupGlyph("unknown")).toBeNull()
  })

  it("keeps every marker one cell wide, so a row's budget arithmetic holds", () => {
    for (const group of TASK_GROUPS) {
      const mark = taskGroupGlyph(group)
      if (mark) expect([...mark.glyph]).toHaveLength(1)
    }
  })
})

describe("taskGroupLabel / taskGroupTone", () => {
  it("labels the four groups a person acts on and leaves the quiet ones silent", () => {
    expect(taskGroupLabel("waiting-on-you")).toBe("needs you")
    expect(taskGroupLabel("landing")).toBe("ready to land")
    expect(taskGroupLabel("ready-for-review")).toBe("needs review")
    expect(taskGroupLabel("working")).toBe("working")
    expect(taskGroupLabel("idle")).toBeNull()
    expect(taskGroupLabel("unknown")).toBeNull()
  })

  it("gives a label exactly when it gives a tone", () => {
    for (const group of TASK_GROUPS) {
      expect(taskGroupLabel(group) === null).toBe(taskGroupTone(group) === null)
    }
  })
})

describe("compareTaskGroup", () => {
  it("puts what needs a person first, regardless of recency", () => {
    const blocked = task("blocked", { updatedAt: new Date(NOW - 86_400_000).toISOString() })
    const busy = task("busy", { updatedAt: new Date(NOW).toISOString() })
    const states = new Map([
      ["blocked", { state: "permission_needed" as const, at: NOW }],
      ["busy", { state: "running" as const, at: NOW }],
    ])
    const sorted = [busy, blocked].sort(compareTaskGroup((id) => states.get(id), NOW))
    expect(sorted.map((t) => t.id)).toEqual(["blocked", "busy"])
  })

  it("breaks a tie inside one group on recency", () => {
    const older = task("older", { updatedAt: new Date(NOW - 86_400_000).toISOString() })
    const newer = task("newer", { updatedAt: new Date(NOW).toISOString() })
    const entry = { state: "permission_needed" as const, at: NOW }
    const sorted = [older, newer].sort(compareTaskGroup(() => entry, NOW))
    expect(sorted.map((t) => t.id)).toEqual(["newer", "older"])
  })

  it("is stable across a debounce boundary crossing mid-sort", () => {
    // `now` is captured once for the whole sort. Reading the clock per
    // comparison would let one task's `error` age past 20s partway through,
    // which makes the comparator inconsistent — the shape that produces a
    // different order every time it runs on the same data.
    const at = NOW - 20_000
    const tasks = Array.from({ length: 8 }, (_, i) => task(`t${i}`))
    const compare = compareTaskGroup(() => ({ state: "error", at }), NOW)
    const first = [...tasks].sort(compare).map((t) => t.id)
    const second = [...tasks]
      .reverse()
      .sort(compare)
      .map((t) => t.id)
    expect(second).toEqual(first)
  })

  it("degrades to pure recency when nothing reports", () => {
    const older = task("older", { updatedAt: new Date(NOW - 86_400_000).toISOString() })
    const newer = task("newer", { updatedAt: new Date(NOW).toISOString() })
    const sorted = [older, newer].sort(compareTaskGroup(() => undefined, NOW))
    expect(sorted.map((t) => t.id)).toEqual(["newer", "older"])
  })
})
