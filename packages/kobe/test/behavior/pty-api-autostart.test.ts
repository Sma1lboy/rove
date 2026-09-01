/**
 * Black-box proof that API automation creates and tears down the same hosted
 * engine session the PureTUI workspace uses, without a mounted TUI.
 */

import { existsSync } from "node:fs"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
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

interface GetTaskResult {
  tabs: Array<{ id: string; alive: boolean }>
}

/**
 * Poll `check` until it reports convergence (returns null) or the deadline
 * passes, then fail with the last observed state. Deletion is deliberately
 * asynchronous (the daemon owns a durable queued → running → finished
 * pipeline), so the post-delete state must be awaited, not asserted at one
 * racily-timed instant.
 */
async function waitForConverged(check: () => string | null, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last: string | null = null
  while (Date.now() < deadline) {
    last = check()
    if (last === null) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`delete did not converge within ${timeoutMs}ms: ${last ?? "unknown"}`)
}

describe("rove api hosted PTY lifecycle (behavior)", () => {
  let env: BehaviorEnv
  let repo: string
  let taskId = ""
  let session = ""
  let worktreePath = ""

  beforeAll(async () => {
    env = await makeBehaviorEnv()
    repo = await makeScratchRepo(env)
  }, 30_000)

  afterAll(async () => {
    await env.dispose()
  })

  it("add --prompt materializes a worktree and auto-starts the canonical engine session", () => {
    const result = runRove(["api", "add", "--repo", repo, "--prompt", "hello from behavior", "--pretty"], env)
    expect(result.code).toBe(0)
    const added = JSON.parse(result.stdout) as AddResult
    taskId = added.taskId
    session = added.session
    worktreePath = added.task.worktreePath

    expect(added.started).toBe(true)
    expect(added.engineReady).toBe(true)
    expect(added.delivered).toBe(true)
    expect(session).toBe(`${taskId}::tab-1`)
    expect(existsSync(worktreePath)).toBe(true)

    const listed = runRove(["api", "pty-list", "--pretty"], env)
    expect(listed.code).toBe(0)
    const sessions = (JSON.parse(listed.stdout) as PtyListResult).sessions
    expect(sessions).toContainEqual(expect.objectContaining({ key: session, alive: true }))
  }, 30_000)

  it("tab-close removes one headless tab and ends only its hosted session", () => {
    const sent = runRove(["api", "send", "--task-id", taskId, "--prompt", "follow-up", "--pretty"], env)
    expect(sent.code, `send failed: stdout=${JSON.stringify(sent.stdout)} stderr=${sent.stderr}`).toBe(0)
    const afterSend = JSON.parse(runRove(["api", "pty-list", "--pretty"], env).stdout) as PtyListResult
    expect(afterSend.sessions.filter((entry) => entry.key === session && entry.alive)).toHaveLength(1)

    const opened = runRove(
      ["api", "send", "--task-id", taskId, "--tab", "new", "--prompt", "second tab", "--pretty"],
      env,
    )
    expect(opened.code, `new tab failed: stdout=${JSON.stringify(opened.stdout)} stderr=${opened.stderr}`).toBe(0)
    const secondSession = (JSON.parse(opened.stdout) as AddResult).session
    expect(secondSession).toBe(`${taskId}::tab-2`)

    const closed = runRove(["api", "tab-close", "--task-id", taskId, "--tab", "tab-2", "--pretty"], env)
    expect(closed.code, `tab-close failed: stdout=${JSON.stringify(closed.stdout)} stderr=${closed.stderr}`).toBe(0)
    expect(JSON.parse(closed.stdout)).toMatchObject({
      ok: true,
      taskId,
      tabId: "tab-2",
      handledBy: "headless",
      kind: "engine",
      wasAlive: true,
    })

    const task = JSON.parse(runRove(["api", "get-task", "--task-id", taskId, "--pretty"], env).stdout) as GetTaskResult
    expect(task.tabs.map((tab) => tab.id)).toEqual(["tab-1"])
    const afterClose = JSON.parse(runRove(["api", "pty-list", "--pretty"], env).stdout) as PtyListResult
    expect(afterClose.sessions.some((entry) => entry.key === secondSession)).toBe(false)
    expect(afterClose.sessions.some((entry) => entry.key === session && entry.alive)).toBe(true)

    const alreadyClosed = runRove(["api", "tab-close", "--task-id", taskId, "--tab", "tab-2", "--pretty"], env)
    expect(alreadyClosed.code).toBe(1)
    const error = JSON.parse(alreadyClosed.stderr) as {
      error: { code: string; hint: string; nextCommandArgs: string[] }
    }
    expect(error.error).toMatchObject({
      code: "TAB_NOT_FOUND",
      nextCommandArgs: ["api", "get-task", "--task-id", taskId],
    })
    expect(error.error.hint).toContain("get-task")
  }, 30_000)

  it("delete tears down the remaining session and worktree", async () => {
    const deleted = runRove(["api", "delete", "--task-id", taskId, "--force"], env)
    expect(deleted.code, `delete failed: stdout=${JSON.stringify(deleted.stdout)} stderr=${deleted.stderr}`).toBe(0)

    // The converged end state: the task is unaddressable (TASK_NOT_FOUND, not
    // a parse of empty output), its hosted session is dead, and its worktree
    // is gone. Before the archive removal (issue #75) this asserted the
    // archived row lingered in the index; delete has no such lingering state.
    await waitForConverged(() => {
      const task = runRove(["api", "get-task", "--task-id", taskId, "--pretty"], env)
      if (task.code !== 1 || !task.stderr.includes("TASK_NOT_FOUND")) {
        return `get-task: code=${task.code} stdout=${JSON.stringify(task.stdout)} stderr=${task.stderr}`
      }
      const listed = runRove(["api", "pty-list", "--pretty"], env)
      if (listed.code !== 0) return `pty-list: code=${listed.code} stderr=${listed.stderr}`
      const sessions = (JSON.parse(listed.stdout) as PtyListResult).sessions
      if (sessions.some((entry) => entry.key === session && entry.alive)) return `session ${session} still alive`
      if (existsSync(worktreePath)) return `worktree still exists: ${worktreePath}`
      return null
    })
  }, 30_000)
})
