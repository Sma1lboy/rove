/**
 * Task deletion is the most destructive thing an `rove api` caller can do to
 * someone else's live session, and until this module existed the daemon logged
 * a line ONLY when the worktree removal FAILED. A successful delete left no
 * record, and no delete recorded who asked — which is why the owner-reported
 * "a tab I was working in vanished and it wasn't me" (2026-08-29) was only
 * traceable by the accident of that removal happening to fail.
 *
 * These assert the two properties a reader of `daemon.log` depends on: every
 * phase leaves a line, and each line carries enough to answer "who and what".
 */

import { afterEach, describe, expect, test, vi } from "vitest"
import type { DaemonTask } from "../../../kobe-daemon/src/daemon/contracts.ts"
import {
  auditDeletionFailed,
  auditDeletionRemoved,
  auditDeletionRequested,
} from "../../../kobe-daemon/src/daemon/task-deletion-audit.ts"

function capture(): { lines: string[]; restore: () => void } {
  const lines: string[] = []
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    lines.push(String(chunk))
    return true
  })
  return { lines, restore: () => spy.mockRestore() }
}

function task(overrides: Partial<DaemonTask> = {}): DaemonTask {
  return {
    id: "01TASK",
    title: "fix the thing",
    repo: "/repo",
    branch: "fix/thing",
    worktreePath: "/wt/hammerhead",
    kind: "task",
    status: "backlog",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    ...overrides,
  }
}

afterEach(() => vi.restoreAllMocks())

describe("task-deletion audit", () => {
  test("a requested deletion names the subject, the flags, and the caller", () => {
    const { lines, restore } = capture()
    auditDeletionRequested(
      "01TASK",
      task(),
      { clientId: 7, requestedBy: { taskId: "01CALLER", tabId: "tab-2" } },
      { force: true, deleteBranch: false },
    )
    restore()
    const line = lines.join("")
    expect(line).toContain("task-deletion-audit")
    expect(line).toContain("requested")
    expect(line).toContain("01TASK")
    expect(line).toContain("fix/thing")
    expect(line).toContain("/wt/hammerhead")
    expect(line).toContain("force=true")
    expect(line).toContain("deleteBranch=false")
    // The whole point: WHO asked.
    expect(line).toContain("by=01CALLER::tab-2")
    expect(line).toContain("client=7")
  })

  test("an unverified caller is left unattributed rather than blamed via the spawner", () => {
    const { lines, restore } = capture()
    // `dispatcher` is the task's SPAWNER — reported, but never as the deleter.
    auditDeletionRequested("01TASK", task({ dispatcher: { taskId: "01SPAWNER", tabId: "tab-1" } }), { clientId: 3 })
    restore()
    const line = lines.join("")
    expect(line).toContain("spawnedBy=01SPAWNER::tab-1")
    expect(line).not.toContain("by=01SPAWNER")
  })

  test("a SUCCESSFUL removal is recorded — the case that used to be silent", () => {
    const { lines, restore } = capture()
    auditDeletionRemoved("01TASK", task())
    restore()
    const line = lines.join("")
    expect(line).toContain("removed")
    expect(line).toContain("01TASK")
    expect(line).toContain("/wt/hammerhead")
  })

  test("a failed removal says what was ALREADY undone, not just the error", () => {
    const { lines, restore } = capture()
    auditDeletionFailed("01TASK", task(), new Error("is not a git worktree"))
    restore()
    const line = lines.join("")
    expect(line).toContain("failed")
    expect(line).toContain("is not a git worktree")
    // The half a bare stack never told anyone: the task is half-deleted.
    expect(line).toContain("ALREADY ran")
  })

  test("a task already dropped from the index still yields a usable line", () => {
    const { lines, restore } = capture()
    auditDeletionRemoved("01GONE", undefined)
    restore()
    expect(lines.join("")).toContain("01GONE")
  })
})
