/**
 * Shared task-action flow tests (`src/tui/lib/task-actions.ts`).
 *
 * Why these matter: the flows are the ONE implementation behind both the
 * deprecated outer monitor (app.tsx) and the Tasks pane (tasks-pane/host.tsx),
 * so a regression here breaks task lifecycle in every host at once. The
 * load-bearing branch under test:
 *
 *   - delete's DIRTY_WORKTREE re-prompt — the guard that keeps a worktree
 *     with uncommitted work from being destroyed without an explicit
 *     force-confirm (KOB-244). A failed/declined delete must leave the hosted
 *     session and selection untouched.
 *
 * The module deliberately has no `@opentui` imports: modal UI arrives as
 * context adapters (`confirm`, `promptText`), so the flows run here with
 * plain mocks. Hosted session operations are module-mocked.
 */

import { type Mock, beforeEach, describe, expect, test, vi } from "vitest"
import { hostedTaskKeys, killHostedSessions, openHostedSessionHost } from "../../src/engine/hosted-session"
import { DIRTY_WORKTREE_CODE } from "../../src/orchestrator/errors"

vi.mock("../../src/engine/hosted-session", () => ({
  openHostedSessionHost: vi.fn(),
  listHostedSessions: vi.fn(async () => []),
  hostedTaskKeys: vi.fn((_sessions: unknown, taskId: string) => [`${taskId}::tab-1`]),
  killHostedSessions: vi.fn(async () => {}),
}))
// Rename/branch/vendor flows live in task-actions-rename.test.ts (file split
// to stay under the ~500-line cap).

import type { RoveOrchestrator } from "../../src/client/remote-orchestrator"
import {
  type TaskActionContext,
  deleteTaskFlow,
  forgetProjectFlow,
  nextActiveTask,
} from "../../src/tui/lib/task-actions"
import type { Task } from "../../src/types/task"

function makeTask(overrides: Omit<Partial<Task>, "id"> & { id: string }): Task {
  return {
    title: overrides.id,
    repo: "/repo",
    branch: `rove/${overrides.id}`,
    worktreePath: `/wt/${overrides.id}`,
    status: "todo",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Task
}

type OrchMock = {
  deleteTask: ReturnType<typeof vi.fn>
  setActiveTask: ReturnType<typeof vi.fn>
  forgetProject: ReturnType<typeof vi.fn>
  setTitle: ReturnType<typeof vi.fn>
  setBranch: ReturnType<typeof vi.fn>
  setVendor: ReturnType<typeof vi.fn>
}

function makeOrch(overrides: Partial<OrchMock> = {}): OrchMock {
  return {
    deleteTask: vi.fn(async () => {}),
    setActiveTask: vi.fn(async () => {}),
    forgetProject: vi.fn(async () => {}),
    setTitle: vi.fn(async () => {}),
    setBranch: vi.fn(async () => {}),
    setVendor: vi.fn(async () => {}),
    ...overrides,
  }
}

function makeCtx(opts: {
  tasks: readonly Task[]
  orch: OrchMock | null
  confirms?: readonly boolean[]
  updateActiveTask?: boolean
  promptTextResult?: string | undefined
  deleteBranchOnDelete?: boolean
  /** What the extra children dialog answers; absent = the host has none. */
  childChoice?: "promote" | "cascade" | "dismiss"
}): {
  ctx: TaskActionContext
  confirm: ReturnType<typeof vi.fn>
  promptText: ReturnType<typeof vi.fn>
  notifyError: ReturnType<typeof vi.fn>
  notifyInfo: ReturnType<typeof vi.fn>
  onTaskDeleted: ReturnType<typeof vi.fn>
  onConversationEnded: Mock
  reload: ReturnType<typeof vi.fn>
  pickChildren: ReturnType<typeof vi.fn>
} {
  const answers = [...(opts.confirms ?? [true])]
  const confirm = vi.fn(async () => answers.shift() ?? false)
  const promptText = vi.fn(async () => opts.promptTextResult)
  const notifyError = vi.fn()
  const notifyInfo = vi.fn()
  const onTaskDeleted = vi.fn()
  const onConversationEnded = vi.fn()
  const reload = vi.fn(async () => {})
  const pickChildren = vi.fn(async () => (opts.childChoice === "dismiss" ? undefined : opts.childChoice))
  const ctx: TaskActionContext = {
    orch: opts.orch as unknown as RoveOrchestrator | null,
    tasks: () => opts.tasks,
    confirm,
    promptText,
    logger: { error: vi.fn() },
    logPrefix: "[test]",
    notifyError,
    notifyInfo,
    reload,
    updateActiveTask: opts.updateActiveTask,
    onTaskDeleted,
    onConversationEnded,
    ...(opts.childChoice === undefined ? {} : { pickChildren }),
    ...(opts.deleteBranchOnDelete === undefined
      ? {}
      : { deleteBranchOnDelete: () => opts.deleteBranchOnDelete === true }),
  }
  return { ctx, confirm, promptText, notifyError, notifyInfo, onTaskDeleted, onConversationEnded, reload, pickChildren }
}

beforeEach(() => {
  vi.mocked(killHostedSessions).mockClear()
  vi.mocked(hostedTaskKeys).mockClear()
  vi.mocked(openHostedSessionHost).mockResolvedValue({
    rpc: { request: vi.fn() },
    close: vi.fn(),
  })
})

describe("nextActiveTask", () => {
  test("skips the excluded id", () => {
    const tasks = [makeTask({ id: "a" }), makeTask({ id: "b" }), makeTask({ id: "c" })]
    expect(nextActiveTask(tasks, "b")?.id).toBe("a")
  })
})

describe("deleteTaskFlow — dirty-worktree branch", () => {
  test("re-prompts on DIRTY_WORKTREE and force-deletes after explicit confirm", async () => {
    const tasks = [makeTask({ id: "t1", title: "dirty" }), makeTask({ id: "t2" })]
    const orch = makeOrch({
      deleteTask: vi.fn(async (_id: string, o?: { force?: boolean }) => {
        if (!o?.force) throw new Error(`${DIRTY_WORKTREE_CODE}: task t1 worktree has uncommitted changes: src/a.ts`)
      }),
    })
    const { ctx, confirm, onTaskDeleted, reload } = makeCtx({ tasks, orch, confirms: [true, true] })

    await deleteTaskFlow(ctx, "t1")

    // Two confirms: the normal delete prompt, then the force re-prompt with
    // the uncommitted-changes copy — the copy is the contract both hosts share.
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(confirm.mock.calls[1]?.[0]).toMatchObject({
      title: `"dirty" has uncommitted changes`,
      confirmLabel: "force delete",
    })
    // The refusal's file list reaches the dialog — it's what the user weighs.
    expect(confirm.mock.calls[1]?.[0].body).toContain("Refused because: worktree has uncommitted changes: src/a.ts")
    expect(orch.deleteTask).toHaveBeenNthCalledWith(1, "t1")
    expect(orch.deleteTask).toHaveBeenNthCalledWith(2, "t1", { force: true })
    // Successful force-delete proceeds to teardown + host selection hook.
    expect(killHostedSessions).toHaveBeenCalledWith(expect.anything(), ["t1::tab-1"])
    expect(reload).toHaveBeenCalledTimes(1)
    expect(onTaskDeleted).toHaveBeenCalledWith("t1", expect.objectContaining({ id: "t2" }))
  })

  test("declined force-delete leaves everything in place", async () => {
    const tasks = [makeTask({ id: "t1" })]
    const orch = makeOrch({
      deleteTask: vi.fn(async () => {
        throw new Error(`refused: ${DIRTY_WORKTREE_CODE}`)
      }),
    })
    const { ctx, onTaskDeleted } = makeCtx({ tasks, orch, confirms: [true, false] })

    await deleteTaskFlow(ctx, "t1")

    expect(orch.deleteTask).toHaveBeenCalledTimes(1)
    expect(killHostedSessions).not.toHaveBeenCalled()
    expect(onTaskDeleted).not.toHaveBeenCalled()
  })

  test("non-dirty failure surfaces a toast and skips teardown", async () => {
    const tasks = [makeTask({ id: "t1" })]
    const orch = makeOrch({
      deleteTask: vi.fn(async () => {
        throw new Error("daemon exploded")
      }),
    })
    const { ctx, confirm, notifyError, onTaskDeleted } = makeCtx({ tasks, orch, confirms: [true] })

    await deleteTaskFlow(ctx, "t1")

    // No force re-prompt for a non-DIRTY error.
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(notifyError).toHaveBeenCalledWith(
      'Couldn\'t delete "t1" — the task and its worktree are untouched: daemon exploded',
    )
    expect(killHostedSessions).not.toHaveBeenCalled()
    expect(onTaskDeleted).not.toHaveBeenCalled()
  })

  test("updates focus before stopping the deleted task's hosted engine", async () => {
    const tasks = [makeTask({ id: "t1" }), makeTask({ id: "t2" })]
    const orch = makeOrch()
    const { ctx } = makeCtx({ tasks, orch, confirms: [true], updateActiveTask: true })

    await deleteTaskFlow(ctx, "t1")

    expect(orch.setActiveTask).toHaveBeenCalledWith("t2")
    expect(killHostedSessions).toHaveBeenCalledWith(expect.anything(), ["t1::tab-1"])
  })
})

describe("deleteTaskFlow — worktree.deleteBranch opt-in", () => {
  test("asks the daemon to delete the branch and says so in the confirm", async () => {
    const tasks = [makeTask({ id: "t1" })]
    const orch = makeOrch()
    const { ctx, confirm } = makeCtx({ tasks, orch, confirms: [true], deleteBranchOnDelete: true })

    await deleteTaskFlow(ctx, "t1")

    expect(confirm.mock.calls[0]?.[0].body).toContain("its git branch if it is merged")
    expect(orch.deleteTask).toHaveBeenCalledWith("t1", { deleteBranch: true })
  })

  test("a forced retry of a dirty worktree keeps the branch", async () => {
    const tasks = [makeTask({ id: "t1" })]
    const orch = makeOrch({
      deleteTask: vi.fn(async (_id: string, o?: { force?: boolean }) => {
        if (!o?.force) throw new Error(`${DIRTY_WORKTREE_CODE}: task t1 worktree has uncommitted changes: a.ts`)
      }),
    })
    const { ctx } = makeCtx({ tasks, orch, confirms: [true, true], deleteBranchOnDelete: true })

    await deleteTaskFlow(ctx, "t1")

    expect(orch.deleteTask).toHaveBeenNthCalledWith(2, "t1", { force: true })
  })

  test("a directory task has no branch to delete", async () => {
    const tasks = [makeTask({ id: "d1", kind: "dir" })]
    const orch = makeOrch()
    const { ctx } = makeCtx({ tasks, orch, confirms: [true], deleteBranchOnDelete: true })

    await deleteTaskFlow(ctx, "d1")

    expect(orch.deleteTask).toHaveBeenCalledWith("d1")
  })
})

describe("deleteTaskFlow — child tasks", () => {
  const family = () => [
    makeTask({ id: "p" }),
    makeTask({ id: "c", parentTaskId: "p" as Task["parentTaskId"] }),
    makeTask({ id: "g", parentTaskId: "c" as Task["parentTaskId"] }),
    makeTask({ id: "other" }),
  ]

  test("a task without children never opens the extra dialog", async () => {
    const { ctx, pickChildren } = makeCtx({
      tasks: family(),
      orch: makeOrch(),
      confirms: [true],
      childChoice: "cascade",
    })
    await deleteTaskFlow(ctx, "other")
    expect(pickChildren).not.toHaveBeenCalled()
  })

  test("promoting keeps the children: a plain delete, only the named task torn down", async () => {
    const orch = makeOrch()
    const { ctx, confirm, pickChildren, onTaskDeleted } = makeCtx({
      tasks: family(),
      orch,
      confirms: [true],
      childChoice: "promote",
    })
    await deleteTaskFlow(ctx, "p")
    expect(pickChildren.mock.calls[0]?.[0]).toMatchObject({ title: '"p" has 1 child tasks' })
    // One dialog, not a confirm followed by the picker.
    expect(confirm).not.toHaveBeenCalled()
    expect(orch.deleteTask).toHaveBeenCalledWith("p")
    expect(killHostedSessions).toHaveBeenCalledTimes(1)
    expect(onTaskDeleted.mock.calls.map((call) => call[0])).toEqual(["p"])
  })

  test("deleting with children cascades, and every removed task is torn down deepest first", async () => {
    const orch = makeOrch({ deleteTask: vi.fn(async () => ({ deleted: ["g", "c", "p"] })) })
    const { ctx, onTaskDeleted } = makeCtx({ tasks: family(), orch, confirms: [true], childChoice: "cascade" })
    await deleteTaskFlow(ctx, "p")
    expect(orch.deleteTask).toHaveBeenCalledWith("p", { cascade: true })
    expect(vi.mocked(killHostedSessions).mock.calls.map((call) => call[1])).toEqual([
      ["g::tab-1"],
      ["c::tab-1"],
      ["p::tab-1"],
    ])
    expect(onTaskDeleted.mock.calls.map((call) => call[0])).toEqual(["g", "c", "p"])
    // The next task to land on is never one that just went.
    expect(onTaskDeleted.mock.calls.every((call) => call[1]?.id === "other")).toBe(true)
  })

  test("an older daemon ignores the cascade: only the task it deleted is torn down", async () => {
    const orch = makeOrch() // replies with neither `deleted` nor `teardown`
    const { ctx, onTaskDeleted } = makeCtx({ tasks: family(), orch, confirms: [true], childChoice: "cascade" })
    await deleteTaskFlow(ctx, "p")
    expect(vi.mocked(killHostedSessions).mock.calls.map((call) => call[1])).toEqual([["p::tab-1"]])
    expect(onTaskDeleted.mock.calls.map((call) => call[0])).toEqual(["p"])
  })

  test("the daemon's teardown scope decides which PTYs are spared", async () => {
    const scope = { spare: ["p::tab-3"], also: [] }
    const orch = makeOrch({ deleteTask: vi.fn(async () => ({ deleted: ["p"], teardown: { p: scope } })) })
    const { ctx } = makeCtx({ tasks: family(), orch, confirms: [true], childChoice: "promote" })
    await deleteTaskFlow(ctx, "p")
    expect(vi.mocked(hostedTaskKeys).mock.calls[0]?.[2]).toEqual(scope)
  })

  test("dismissing the extra dialog abandons the delete", async () => {
    const orch = makeOrch()
    const { ctx, onTaskDeleted } = makeCtx({ tasks: family(), orch, confirms: [true], childChoice: "dismiss" })
    await deleteTaskFlow(ctx, "p")
    expect(orch.deleteTask).not.toHaveBeenCalled()
    expect(onTaskDeleted).not.toHaveBeenCalled()
  })

  test("a forced retry of a dirty worktree keeps the cascade", async () => {
    const orch = makeOrch({
      deleteTask: vi.fn(async (_id: string, o?: { force?: boolean }) => {
        if (!o?.force) throw new Error(`${DIRTY_WORKTREE_CODE}: task p worktree has uncommitted changes: a.ts`)
      }),
    })
    const { ctx } = makeCtx({ tasks: family(), orch, confirms: [true, true], childChoice: "cascade" })
    await deleteTaskFlow(ctx, "p")
    expect(orch.deleteTask).toHaveBeenNthCalledWith(2, "p", { force: true, cascade: true })
  })
})

describe("forgetProjectFlow", () => {
  const main = () =>
    makeTask({ id: "m1", kind: "main", repo: "/repos/alpha", title: "alpha", worktreePath: "/repos/alpha" })

  test("forgets the project, no worktree teardown", async () => {
    const orch = makeOrch()
    const { ctx, confirm, reload } = makeCtx({ tasks: [main()], orch, confirms: [true] })

    await forgetProjectFlow(ctx, "m1")

    // Project-specific copy (the "remove" verb, not "delete").
    expect(confirm.mock.calls[0]?.[0]).toMatchObject({ title: `Remove project "alpha"?`, confirmLabel: "remove" })
    expect(orch.forgetProject).toHaveBeenCalledWith("/repos/alpha")
    expect(orch.deleteTask).not.toHaveBeenCalled()
    expect(killHostedSessions).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  test("the dialog names the repo even when the main row was renamed", async () => {
    const renamed = { ...main(), title: "Plan the release" }
    const { ctx, confirm } = makeCtx({ tasks: [renamed], orch: makeOrch(), confirms: [false] })

    await forgetProjectFlow(ctx, "m1")

    expect(confirm.mock.calls[0]?.[0]).toMatchObject({ title: `Remove project "alpha"?` })
  })

  test("declined confirm leaves the project in place", async () => {
    const orch = makeOrch()
    const { ctx } = makeCtx({ tasks: [main()], orch, confirms: [false] })

    await forgetProjectFlow(ctx, "m1")

    expect(orch.forgetProject).not.toHaveBeenCalled()
  })

  test("forget failure surfaces a toast and skips reload", async () => {
    const orch = makeOrch({
      forgetProject: vi.fn(async () => {
        throw new Error("daemon exploded")
      }),
    })
    const { ctx, notifyError, reload } = makeCtx({ tasks: [main()], orch, confirms: [true] })

    await forgetProjectFlow(ctx, "m1")

    expect(notifyError).toHaveBeenCalledWith(
      "Couldn't remove the project — it stays in the projects list: daemon exploded",
    )
    expect(reload).not.toHaveBeenCalled()
  })
})

describe("deleteTaskFlow — project (main) row", () => {
  const main = () =>
    makeTask({ id: "m1", kind: "main", repo: "/repos/alpha", title: "alpha", worktreePath: "/repos/alpha" })
  const child = (id: string) => makeTask({ id, parentTaskId: "m1" as Task["parentTaskId"], repo: "/repos/alpha" })

  test("ends the conversation and keeps the project: sessions killed, tabs dropped, nothing deleted", async () => {
    const orch = makeOrch()
    const { ctx, confirm, reload, onConversationEnded } = makeCtx({ tasks: [main()], orch, confirms: [true] })

    await deleteTaskFlow(ctx, "m1")

    expect(confirm.mock.calls[0]?.[0]).toMatchObject({ title: `Delete conversation "alpha"?`, danger: true })
    expect(orch.deleteTask).not.toHaveBeenCalled()
    expect(orch.forgetProject).not.toHaveBeenCalled()
    expect(killHostedSessions).toHaveBeenCalledWith(expect.anything(), ["m1::tab-1"])
    expect(onConversationEnded).toHaveBeenCalledWith("m1")
    expect(reload).toHaveBeenCalledTimes(1)
  })

  test("a declined confirm ends nothing", async () => {
    const { ctx, onConversationEnded } = makeCtx({ tasks: [main()], orch: makeOrch(), confirms: [false] })

    await deleteTaskFlow(ctx, "m1")

    expect(killHostedSessions).not.toHaveBeenCalled()
    expect(onConversationEnded).not.toHaveBeenCalled()
  })

  test("with children, ending alone leaves them standing", async () => {
    const orch = makeOrch()
    const { ctx, pickChildren } = makeCtx({
      tasks: [main(), child("c1")],
      orch,
      childChoice: "promote",
    })

    await deleteTaskFlow(ctx, "m1")

    expect(pickChildren.mock.calls[0]?.[0]).toMatchObject({ title: `"alpha" has 1 child tasks` })
    expect(orch.deleteTask).not.toHaveBeenCalled()
    expect(killHostedSessions).toHaveBeenCalledTimes(1)
  })

  test("with children, the second choice deletes each child's subtree before ending the conversation", async () => {
    const orch = makeOrch()
    const { ctx, onConversationEnded } = makeCtx({
      tasks: [main(), child("c1"), child("c2")],
      orch,
      childChoice: "cascade",
    })

    await deleteTaskFlow(ctx, "m1")

    expect(orch.deleteTask.mock.calls).toEqual([
      ["c1", { cascade: true }],
      ["c2", { cascade: true }],
    ])
    expect(onConversationEnded).toHaveBeenCalledWith("m1")
  })

  test("a child whose delete is declined stops the round: the conversation is not ended", async () => {
    const orch = makeOrch({
      deleteTask: vi.fn(async () => {
        throw new Error(`${DIRTY_WORKTREE_CODE}: task c1 worktree has uncommitted changes: a.ts`)
      }),
    })
    const { ctx, onConversationEnded } = makeCtx({
      tasks: [main(), child("c1")],
      orch,
      confirms: [false],
      childChoice: "cascade",
    })

    await deleteTaskFlow(ctx, "m1")

    expect(killHostedSessions).not.toHaveBeenCalled()
    expect(onConversationEnded).not.toHaveBeenCalled()
  })
})

describe("deleteTaskFlow — misc guards", () => {
  test("unknown taskId is a no-op", async () => {
    const tasks = [makeTask({ id: "t1" })]
    const orch = makeOrch()
    const { ctx, confirm } = makeCtx({ tasks, orch, confirms: [true] })

    await deleteTaskFlow(ctx, "nope")

    expect(confirm).not.toHaveBeenCalled()
    expect(orch.deleteTask).not.toHaveBeenCalled()
  })

  test("no daemon (orch null) is a no-op", async () => {
    const tasks = [makeTask({ id: "t1" })]
    const { ctx, confirm } = makeCtx({ tasks, orch: null })

    await deleteTaskFlow(ctx, "t1")

    expect(confirm).not.toHaveBeenCalled()
  })
})
