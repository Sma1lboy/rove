/**
 * Black-box proof that API automation creates and tears down the same hosted
 * engine session the PureTUI workspace uses, without a mounted TUI.
 */

import { existsSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { type BehaviorEnv, makeBehaviorEnv, makeScratchRepo, runRove } from "./harness.ts"

interface AddResult {
  taskId: string
  task: { worktreePath: string }
  session: string
  started: boolean
  engineReady: boolean
  delivered: boolean
}

interface PtyListResult {
  sessions: Array<{ key: string; alive: boolean; command: string[] }>
}

interface OpenedTabResult {
  tabId: string
  childTaskId?: string
}

interface GetTaskResult {
  tabs: Array<{ id: string; alive: boolean }>
}

describe("rove api hosted PTY lifecycle (behavior)", () => {
  let env: BehaviorEnv
  let repo: string

  beforeEach(async () => {
    env = await makeBehaviorEnv()
    repo = await makeScratchRepo(env)
  }, 30_000)

  afterEach(async () => {
    await env.dispose()
  })

  const ptySessions = (): PtyListResult["sessions"] =>
    (JSON.parse(runRove(["api", "pty-list", "--pretty"], env).stdout) as PtyListResult).sessions

  const addTask = (): AddResult => {
    const result = runRove(["api", "add", "--repo", repo, "--prompt", "hello from behavior", "--pretty"], env)
    expect(result.code, result.stderr).toBe(0)
    return JSON.parse(result.stdout) as AddResult
  }

  const expectTaskGone = (id: string): void => {
    const task = runRove(["api", "get-task", "--task-id", id, "--pretty"], env)
    expect(task.code, `task still addressable: ${task.stdout}`).toBe(1)
    expect(task.stderr).toContain("TASK_NOT_FOUND")
  }

  // Deletion is asynchronous (the daemon owns a durable queued → running →
  // finished pipeline), so the post-delete state is awaited, not raced.
  const converged = { timeout: 15_000, interval: 250 }

  /**
   * `sessions: []` used to be the answer for BOTH "a live host with nothing
   * running" and "no host at all", so an agent reading `{"sessions":[]}`
   * concluded the fleet was idle — and could respawn work that was actually
   * running, or call a live task dead. `null` means "could not look", the same
   * shape `inspect`'s sessions section has always returned for this failure.
   *
   * Each test gets a fresh home, so nothing has spawned a host yet. The
   * live-host half (an actual array) is every other `pty-list` assertion here.
   */
  it("pty-list answers null when there is no pty host to ask", () => {
    const cold = runRove(["api", "pty-list", "--pretty"], env)
    expect(cold.code, `pty-list failed: ${cold.stderr}`).toBe(0)
    expect((JSON.parse(cold.stdout) as { sessions: unknown }).sessions).toBeNull()
  }, 15_000)

  it("add --prompt materializes a worktree and auto-starts the canonical engine session", () => {
    const added = addTask()

    expect(added.started).toBe(true)
    expect(added.engineReady).toBe(true)
    expect(added.delivered).toBe(true)
    expect(added.session).toBe(`${added.taskId}::tab-1`)
    expect(existsSync(added.task.worktreePath)).toBe(true)
    expect(ptySessions()).toContainEqual(expect.objectContaining({ key: added.session, alive: true }))
  }, 30_000)

  it("add --no-worktree opens a shared child; deleting it ends only its hosted session", async () => {
    const { taskId, session, task } = addTask()
    const sent = runRove(["api", "send", "--task-id", taskId, "--prompt", "follow-up", "--pretty"], env)
    expect(sent.code, `send failed: stdout=${JSON.stringify(sent.stdout)} stderr=${sent.stderr}`).toBe(0)
    expect(ptySessions().filter((entry) => entry.key === session && entry.alive)).toHaveLength(1)

    const opened = runRove(
      ["api", "add", "--parent", taskId, "--no-worktree", "--prompt", "second conversation", "--pretty"],
      env,
    )
    expect(opened.code, `new child failed: stdout=${JSON.stringify(opened.stdout)} stderr=${opened.stderr}`).toBe(0)
    const childSession = (JSON.parse(opened.stdout) as AddResult).session
    const childId = childSession.replace(/::tab-1$/, "")
    // A second conversation is a child task, not a second tab on the parent.
    expect(childId).not.toBe(taskId)
    expect(childSession).toBe(`${childId}::tab-1`)
    const parent = JSON.parse(
      runRove(["api", "get-task", "--task-id", taskId, "--pretty"], env).stdout,
    ) as GetTaskResult
    expect(parent.tabs.map((tab) => tab.id)).toEqual(["tab-1"])

    const deleted = runRove(["api", "delete", "--task-id", childId, "--force"], env)
    expect(deleted.code, `delete child failed: stdout=${JSON.stringify(deleted.stdout)} stderr=${deleted.stderr}`).toBe(
      0,
    )
    await vi.waitFor(() => {
      expectTaskGone(childId)
      expect(ptySessions()).not.toContainEqual(expect.objectContaining({ key: childSession, alive: true }))
    }, converged)
    expect(ptySessions()).toContainEqual(expect.objectContaining({ key: session, alive: true }))
    // The shared child never owned the directory; the parent keeps it.
    expect(existsSync(task.worktreePath)).toBe(true)
  }, 60_000)

  it("a new shell is its own child row; closing it ends only its hosted session", () => {
    const { taskId, session } = addTask()
    const opened = runRove(["api", "tab-new", "--task-id", taskId, "--kind", "shell", "--pretty"], env)
    expect(opened.code, `tab-new failed: stdout=${JSON.stringify(opened.stdout)} stderr=${opened.stderr}`).toBe(0)
    const { tabId, childTaskId } = JSON.parse(opened.stdout) as OpenedTabResult
    expect(childTaskId).toBeTruthy()
    expect(childTaskId).not.toBe(taskId)
    const shellTask = childTaskId as string

    const closed = runRove(["api", "tab-close", "--task-id", shellTask, "--tab", tabId, "--pretty"], env)
    expect(closed.code, `tab-close failed: stdout=${JSON.stringify(closed.stdout)} stderr=${closed.stderr}`).toBe(0)
    expect(JSON.parse(closed.stdout)).toMatchObject({ ok: true, taskId: shellTask, tabId })

    const parent = JSON.parse(
      runRove(["api", "get-task", "--task-id", taskId, "--pretty"], env).stdout,
    ) as GetTaskResult
    expect(parent.tabs.map((tab) => tab.id)).toEqual(["tab-1"])
    const afterClose = ptySessions()
    expect(afterClose.some((entry) => entry.key === `${shellTask}::${tabId}`)).toBe(false)
    expect(afterClose).toContainEqual(expect.objectContaining({ key: session, alive: true }))

    const alreadyClosed = runRove(["api", "tab-close", "--task-id", shellTask, "--tab", tabId, "--pretty"], env)
    expect(alreadyClosed.code).toBe(1)
    const error = JSON.parse(alreadyClosed.stderr) as {
      error: { code: string; hint: string; nextCommandArgs: string[] }
    }
    expect(error.error).toMatchObject({
      code: "TAB_NOT_FOUND",
      nextCommandArgs: ["api", "get-task", "--task-id", shellTask],
    })
    expect(error.error.hint).toContain("get-task")
  }, 45_000)

  it("deleting a parent promotes its shared child and keeps the directory until the last user is gone", async () => {
    const { taskId, session, task } = addTask()
    const opened = runRove(["api", "add", "--parent", taskId, "--no-worktree", "--prompt", "survivor", "--pretty"], env)
    expect(opened.code, `new child failed: stdout=${JSON.stringify(opened.stdout)} stderr=${opened.stderr}`).toBe(0)
    const childSession = (JSON.parse(opened.stdout) as AddResult).session
    const childId = childSession.replace(/::tab-1$/, "")

    const deleted = runRove(["api", "delete", "--task-id", taskId, "--force"], env)
    expect(deleted.code, `delete failed: stdout=${JSON.stringify(deleted.stdout)} stderr=${deleted.stderr}`).toBe(0)
    await vi.waitFor(() => {
      expectTaskGone(taskId)
      expect(ptySessions()).not.toContainEqual(expect.objectContaining({ key: session, alive: true }))
    }, converged)
    // The child outlives the parent and still has its directory.
    const child = runRove(["api", "get-task", "--task-id", childId, "--pretty"], env)
    expect(child.code, `child lost: ${child.stderr}`).toBe(0)
    expect(ptySessions()).toContainEqual(expect.objectContaining({ key: childSession, alive: true }))
    expect(existsSync(task.worktreePath)).toBe(true)

    // Removing the last task that uses the directory removes the worktree.
    const last = runRove(["api", "delete", "--task-id", childId, "--force"], env)
    expect(last.code, `delete child failed: stdout=${JSON.stringify(last.stdout)} stderr=${last.stderr}`).toBe(0)
    await vi.waitFor(() => {
      expectTaskGone(childId)
      expect(ptySessions()).not.toContainEqual(expect.objectContaining({ key: childSession, alive: true }))
      expect(existsSync(task.worktreePath)).toBe(false)
    }, converged)
  }, 90_000)
})
