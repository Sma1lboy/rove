/**
 * Scale guard for the sidebar tree's orphan backstop (`filterKnownOrphanTabs`
 * in orphan-tabs): orphan tabs are keyed by task id, and proving each orphan's
 * task still exists with a `tasks.some(...)` scan would be O(orphans ×
 * tasks) on every poll tick, i.e. a few hundred scans of a few hundred
 * entries at real-install scale. The pure keeps ONE Set build for all
 * orphans; the instrumented array below fails the test on any per-orphan
 * linear scan, and pins the keep/drop semantics at the same time.
 */

import { describe, expect, it } from "vitest"
import { filterKnownOrphanTabs } from "../../src/tui-react/panes/sidebar/orphan-tabs"
import type { TreeTab } from "../../src/tui/panes/sidebar/tree-core"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"

function task(id: string): Task {
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
  }
}

function tab(id: string): TreeTab {
  return { id, label: id }
}

class CountingTasks extends Array<Task> {
  somes = 0
  override some(predicate: (value: Task, index: number, array: Task[]) => unknown, thisArg?: unknown): boolean {
    this.somes += 1
    return super.some(predicate)
  }
}

describe("filterKnownOrphanTabs", () => {
  it("keeps orphans of live tasks and drops orphans of deleted ones", () => {
    const tasks = new CountingTasks(task("live-a"), task("live-b"))
    const orphans = new Map<string, readonly TreeTab[]>([
      ["live-a", [tab("tab-1")]],
      ["deleted-c", [tab("tab-9")]],
      ["live-b", [tab("tab-2"), tab("tab-3")]],
    ])
    const known = filterKnownOrphanTabs(tasks, orphans)
    expect([...known.keys()]).toEqual(["live-a", "live-b"])
    expect(known.get("live-b")).toHaveLength(2)
  })

  it("performs zero per-orphan linear scans of the task list", () => {
    const tasks = new CountingTasks(...Array.from({ length: 400 }, (_, i) => task(`task-${i}`)))
    const orphans = new Map<string, readonly TreeTab[]>(
      Array.from({ length: 50 }, (_, i) => [`task-${i}`, [tab(`tab-${i}`)]]),
    )
    const known = filterKnownOrphanTabs(tasks, orphans)
    expect(known.size).toBe(50)
    // The tripwire: a `tasks.some` inside the orphan loop increments this
    // once PER ORPHAN. Reverting to the per-orphan scan makes it 50.
    expect(tasks.somes).toBe(0)
  })
})
