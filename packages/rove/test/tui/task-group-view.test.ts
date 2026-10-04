/**
 * Presentation of the derived task group: which word a board badge shows,
 * and the `attention` sort's ranking.
 *
 * The derivation itself is tested in `test/lib/task-group.test.ts`; this pins
 * the half the board and the sort share, so they cannot disagree about what
 * `waiting-on-you` means.
 */

import { describe, expect, it } from "vitest"
import { TASK_GROUPS } from "../../src/lib/task-group.ts"
import {
  compareTaskGroup,
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

describe("taskGroupLabel / taskGroupTone", () => {
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
