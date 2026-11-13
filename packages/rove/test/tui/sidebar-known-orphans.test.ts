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

describe("filterKnownOrphanTabs", () => {
  it("keeps orphans of live tasks and drops orphans of deleted ones", () => {
    const tasks = [task("live-a"), task("live-b")]
    const orphans = new Map<string, readonly TreeTab[]>([
      ["live-a", [tab("tab-1")]],
      ["deleted-c", [tab("tab-9")]],
      ["live-b", [tab("tab-2"), tab("tab-3")]],
    ])
    const known = filterKnownOrphanTabs(tasks, orphans)
    expect([...known.keys()]).toEqual(["live-a", "live-b"])
    expect(known.get("live-b")).toHaveLength(2)
  })
})
