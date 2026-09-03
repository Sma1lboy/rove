/**
 * Regression pin: `n` receives the created task id from the RPC before the
 * daemon snapshot necessarily causes a React render. Activation must not wait
 * for a second Enter just because the task is absent from the current snapshot.
 */

import { describe, expect, test, vi } from "vitest"
import { TaskDeletingError } from "../../src/orchestrator/errors"
import {
  activateWorkspaceTask,
  activationErrorMessage,
  firstSelectableTask,
} from "../../src/tui-react/workspace/use-task-selection"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"

function task(id: string, worktreePath: string): Task {
  return {
    id: toTaskId(id),
    title: id,
    repo: "/repo",
    branch: "main",
    worktreePath,
    kind: "task",
    status: "backlog",
    pinned: false,
    vendor: "claude",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

describe("pure-TUI workspace task activation", () => {
  test("materializes and focuses a newly created task before its snapshot renders", async () => {
    const ensureWorktree = vi.fn(async () => "/worktrees/new-task")
    const selectTask = vi.fn()
    const focusWorkspace = vi.fn()

    const activated = await activateWorkspaceTask(
      {
        getTask: () => undefined,
        ensureWorktree,
        selectTask,
        focusWorkspace,
        reportError: vi.fn(),
      },
      "new-task",
    )

    expect(activated).toBe(true)
    expect(ensureWorktree).toHaveBeenCalledWith("new-task")
    expect(selectTask).toHaveBeenCalledWith("new-task")
    expect(focusWorkspace).toHaveBeenCalledOnce()
  })

  test("does not change selection when worktree materialization fails", async () => {
    const error = new Error("git worktree add failed")
    const reportError = vi.fn()
    const selectTask = vi.fn()
    const focusWorkspace = vi.fn()

    const activated = await activateWorkspaceTask(
      {
        getTask: () => undefined,
        ensureWorktree: vi.fn(async () => {
          throw error
        }),
        selectTask,
        focusWorkspace,
        reportError,
      },
      "new-task",
    )

    expect(activated).toBe(false)
    expect(reportError).toHaveBeenCalledWith(error)
    expect(selectTask).not.toHaveBeenCalled()
    expect(focusWorkspace).not.toHaveBeenCalled()
  })

  test("keeps the local fast path for an already materialized task", async () => {
    const ensureWorktree = vi.fn(async () => "/worktrees/existing")
    const selectTask = vi.fn()
    const focusWorkspace = vi.fn()
    const existing = task("existing", "/worktrees/existing")

    const activated = await activateWorkspaceTask(
      {
        getTask: () => existing,
        ensureWorktree,
        selectTask,
        focusWorkspace,
        reportError: vi.fn(),
      },
      "existing",
    )

    expect(activated).toBe(true)
    expect(ensureWorktree).not.toHaveBeenCalled()
    expect(selectTask).toHaveBeenCalledWith("existing")
    expect(focusWorkspace).toHaveBeenCalledOnce()
  })

  test("refuses to activate a task whose background deletion was accepted", async () => {
    const deleting = {
      ...task("deleting", "/worktrees/deleting"),
      deletion: { phase: "queued" as const, force: false, requestedAt: "2026-07-15T00:00:00.000Z" },
    }
    const reportError = vi.fn()
    const ensureWorktree = vi.fn(async () => "/worktrees/deleting")
    const selectTask = vi.fn()

    await expect(
      activateWorkspaceTask(
        {
          getTask: () => deleting,
          ensureWorktree,
          selectTask,
          focusWorkspace: vi.fn(),
          reportError,
        },
        deleting.id,
      ),
    ).resolves.toBe(false)
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("TASK_DELETING") }),
    )
    expect(ensureWorktree).not.toHaveBeenCalled()
    expect(selectTask).not.toHaveBeenCalled()
  })

  test("a superseded activation resolves without stealing selection or focus", async () => {
    const selectTask = vi.fn()
    const focusWorkspace = vi.fn()
    let releaseSlowWorktree: (() => void) | undefined
    const slow = activateWorkspaceTask(
      {
        getTask: () => undefined,
        ensureWorktree: () =>
          new Promise((resolve) => {
            releaseSlowWorktree = () => resolve("/worktrees/slow")
          }),
        selectTask,
        focusWorkspace,
        reportError: vi.fn(),
        isCurrent: () => false,
      },
      "slow-task",
    )

    const fast = await activateWorkspaceTask(
      {
        getTask: (id) => task(id, "/worktrees/fast"),
        ensureWorktree: vi.fn(async () => "/worktrees/fast"),
        selectTask,
        focusWorkspace,
        reportError: vi.fn(),
        isCurrent: () => true,
      },
      "fast-task",
    )
    releaseSlowWorktree?.()

    expect(fast).toBe(true)
    expect(await slow).toBe(false)
    expect(selectTask).toHaveBeenCalledTimes(1)
    expect(selectTask).toHaveBeenCalledWith("fast-task")
    expect(focusWorkspace).toHaveBeenCalledTimes(1)
  })

  // Why: the SSH-reconnect "reopens on the oldest project" bug — a stale or
  // freshly-respawned daemon replays a null/ancient focus, and a
  // fallback on tasks.json ARRAY order leads with the oldest saved
  // repo's main task (wakey). Restore order must be: daemon focus →
  // persisted lastActive → newest updatedAt; never raw array position.
  test("selection restore prefers active → persisted lastActive → most recently updated", () => {
    const active = task("active", "/worktrees/active")
    const deleting = {
      ...task("deleting", "/worktrees/deleting"),
      deletion: { phase: "queued" as const, force: false, requestedAt: "2026-07-15T00:00:00.000Z" },
    }
    const stale = { ...task("stale", "/worktrees/stale"), updatedAt: "2026-01-01T00:00:00.000Z" }
    const recent = { ...task("recent", "/worktrees/recent"), updatedAt: "2026-07-01T00:00:00.000Z" }

    expect(firstSelectableTask([deleting, active, recent], "active")).toBe(active)
    // Daemon focus missing → the persisted lastActive record wins.
    expect(firstSelectableTask([stale, active, recent], null, "active")).toBe(active)
    expect(firstSelectableTask([stale, active, recent], "missing", "active")).toBe(active)
    // A deleting lastActive is dead — fall through, never resurrect it.
    expect(firstSelectableTask([deleting, stale, recent], null, "deleting")).toBe(recent)
    // No focus records at all → newest live task, NOT array-first.
    expect(firstSelectableTask([stale, recent], null)).toBe(recent)
    expect(firstSelectableTask([deleting], null)).toBeUndefined()
    expect(firstSelectableTask([], null)).toBeUndefined()
  })

  test("a routine's standing session never wins the recency fallback", () => {
    const mine = { ...task("mine", "/worktrees/mine"), updatedAt: "2026-07-01T00:00:00.000Z" }
    // Fired at 03:00, so it is genuinely the most recently updated task in the
    // install — and the least likely thing the user meant to open. Its sidebar
    // row is folded away too, so booting onto it would put the cursor on a
    // session with no visible row.
    const routine = {
      ...task("nightly", "/worktrees/nightly"),
      updatedAt: "2026-07-02T03:00:00.000Z",
      routine: { automationId: "auto-1" },
    }

    expect(firstSelectableTask([mine, routine], null)).toBe(mine)
    // Naming it explicitly still selects it — that was a real choice.
    expect(firstSelectableTask([mine, routine], "nightly")).toBe(routine)
    expect(firstSelectableTask([mine, routine], null, "nightly")).toBe(routine)
    // And it is still better than nothing when it is all there is.
    expect(firstSelectableTask([routine], null)).toBe(routine)
  })
})

/**
 * The activation refusals the user actually SEES. `activateWorkspaceTask`
 * returning false is only half the contract — the earlier bug was that the
 * refusal reached `console.error` and nothing else, so Enter on an
 * unmaterializable row was an infinite silent no-op.
 *
 * These assert the STRING handed to the toast, keyed by catalog id, so a
 * regression that drops the mapping (or points every case at the generic
 * copy) fails rather than passing on "reportError was called".
 */
describe("activation failures map onto user-visible copy", () => {
  // Stand-in for the real `t`: returns the key plus its interpolations, so a
  // wrong key or a dropped {message} is visible in the assertion.
  const translate = (key: string, vars?: Record<string, string>) => (vars ? `${key}|${JSON.stringify(vars)}` : key)

  test("a mid-delete task says so instead of reporting a worktree failure", () => {
    expect(activationErrorMessage(new TaskDeletingError("t1"), translate)).toBe("tasks.toast.worktreeErrorDeleting")
  })

  test("the daemon's plain-Error rebuild of the same refusal still maps to the deleting copy", () => {
    // The RPC layer reconstructs thrown errors as `new Error(message)`, so the
    // class is gone by the time this runs — matching must be on the message.
    const overWire = new Error("TASK_DELETING: task t1 is being deleted")
    expect(activationErrorMessage(overWire, translate)).toBe("tasks.toast.worktreeErrorDeleting")
  })

  test("a non-git project gets the actionable `git init` copy", () => {
    const err = new Error("fatal: not a git repository (or any of the parent directories): .git")
    expect(activationErrorMessage(err, translate)).toBe("tasks.toast.worktreeErrorNotGit")
  })

  test("any other failure carries the underlying reason through", () => {
    const message = activationErrorMessage(new Error("worktree is locked"), translate)
    expect(message).toContain("tasks.toast.worktreeErrorGeneric")
    expect(message).toContain("worktree is locked")
  })
})
