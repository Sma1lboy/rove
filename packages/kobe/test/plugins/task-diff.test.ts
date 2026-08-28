import type { SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { bornWithWorktree, diffTask } from "@sma1lboy/kobe-daemon/plugins/task-diff"
import { describe, expect, it } from "vitest"

function task(extra: Partial<SerializedTask> = {}): SerializedTask {
  return {
    id: "a",
    title: "t",
    repo: "/repo",
    branch: "b",
    worktreePath: "/wt",
    kind: "task",
    status: "active",
    archived: false,
    pinned: false,
    createdAt: "x",
    updatedAt: "x",
    ...extra,
  } as SerializedTask
}

describe("diffTask", () => {
  it("returns null when nothing watched changed (updatedAt/position excluded)", () => {
    expect(diffTask(task(), task({ updatedAt: "y", position: 3 }))).toBeNull()
  })

  it("collects changed fields with from/to", () => {
    const diff = diffTask(task(), task({ title: "renamed", pinned: true }))
    expect(diff).toMatchObject({
      fields: ["title", "pinned"],
      from: { title: "t", pinned: false },
      to: { title: "renamed", pinned: true },
    })
  })

  it("flags archivedNow only on the false→true flip", () => {
    expect(diffTask(task(), task({ archived: true }))?.archivedNow).toBe(true)
    expect(diffTask(task({ archived: true }), task())?.archivedNow).toBe(false)
  })

  it("flags prChanged via deep compare, outside `fields`", () => {
    const withPr = task({ prStatus: { state: "open" } as never })
    const diff = diffTask(task(), withPr)
    expect(diff).toMatchObject({ fields: [], prChanged: true })
    // Structurally equal prStatus objects are not a change.
    expect(diffTask(withPr, task({ prStatus: { state: "open" } as never }))).toBeNull()
  })

  it("flags worktreeCreated for a task-kind empty→set transition only", () => {
    expect(diffTask(task({ worktreePath: "" }), task())?.worktreeCreated).toBe(true)
    expect(diffTask(task({ kind: "main", worktreePath: "" }), task({ kind: "main" }))?.worktreeCreated).toBe(false)
    // Path CHANGE (move) is a task.changed field, not a new worktree.
    expect(diffTask(task(), task({ worktreePath: "/other" }))?.worktreeCreated).toBe(false)
  })
})

describe("bornWithWorktree", () => {
  it("true only for task-kind rows created with a path", () => {
    expect(bornWithWorktree(task())).toBe(true)
    expect(bornWithWorktree(task({ worktreePath: "" }))).toBe(false)
    expect(bornWithWorktree(task({ kind: "main" }))).toBe(false)
  })
})
