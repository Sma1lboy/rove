/**
 * Rename/branch/vendor flows from `src/tui/lib/task-actions.ts` — split out
 * of task-actions.test.ts (delete flows) to keep both files under the
 * ~500-line cap. Same harness shape: modal UI arrives as context adapters, so
 * the flows run with plain mocks; engine detection is
 * module-mocked (every export the flows touch is stubbed).
 */

import { describe, expect, test, vi } from "vitest"

// cycleVendorFlow calls availableEngineIds() — the real one probes PATH
// binaries + reads state.json. Stub for hermeticity.
vi.mock("../../src/engine/account-detect", () => ({
  availableEngineIds: vi.fn(async () => ["claude", "codex"]),
}))

import type { KobeOrchestrator } from "../../src/client/remote-orchestrator"
import {
  type TaskActionContext,
  copyTaskFieldFlow,
  cycleVendorFlow,
  renameBranchFlow,
  renameTaskFlow,
  setStatusFlow,
} from "../../src/tui/lib/task-actions"
import type { Task, TaskStatus } from "../../src/types/task"

function makeTask(overrides: Omit<Partial<Task>, "id"> & { id: string }): Task {
  return {
    title: overrides.id,
    repo: "/repo",
    branch: `kobe/${overrides.id}`,
    worktreePath: `/wt/${overrides.id}`,
    status: "todo",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Task
}

type OrchMock = {
  setTitle: ReturnType<typeof vi.fn>
  setBranch: ReturnType<typeof vi.fn>
  setVendor: ReturnType<typeof vi.fn>
  setStatus: ReturnType<typeof vi.fn>
}

function makeOrch(overrides: Partial<OrchMock> = {}): OrchMock {
  return {
    setTitle: vi.fn(async () => {}),
    setBranch: vi.fn(async () => {}),
    setVendor: vi.fn(async () => {}),
    setStatus: vi.fn(async () => {}),
    ...overrides,
  }
}

function makeCtx(opts: {
  tasks: readonly Task[]
  orch: OrchMock | null
  promptTextResult?: string | undefined
  /** `undefined` = the picker was cancelled; omit the key entirely to leave
   *  `pickStatus` unwired, the shape a host without the dialog has. */
  pickStatusResult?: TaskStatus | undefined
  wirePickStatus?: boolean
  /** Same shape as `wirePickStatus`: false = a host with no clipboard writer. */
  wireCopyText?: boolean
}): {
  ctx: TaskActionContext
  promptText: ReturnType<typeof vi.fn>
  pickStatus: ReturnType<typeof vi.fn>
  copyText: ReturnType<typeof vi.fn>
  notifyError: ReturnType<typeof vi.fn>
  notifyInfo: ReturnType<typeof vi.fn>
  reload: ReturnType<typeof vi.fn>
} {
  const promptText = vi.fn(async () => opts.promptTextResult)
  const pickStatus = vi.fn(async () => opts.pickStatusResult)
  const copyText = vi.fn()
  const notifyError = vi.fn()
  const notifyInfo = vi.fn()
  const reload = vi.fn(async () => {})
  const ctx: TaskActionContext = {
    orch: opts.orch as unknown as KobeOrchestrator | null,
    tasks: () => opts.tasks,
    confirm: async () => true,
    promptText,
    ...(opts.wirePickStatus === false ? {} : { pickStatus }),
    ...(opts.wireCopyText === false ? {} : { copyText }),
    logger: { error: vi.fn() },
    logPrefix: "[test]",
    notifyError,
    notifyInfo,
    reload,
  }
  return { ctx, promptText, pickStatus, copyText, notifyError, notifyInfo, reload }
}

describe("renameTaskFlow", () => {
  test("renames the task title and reloads", async () => {
    const tasks = [makeTask({ id: "t1", title: "old title" })]
    const orch = makeOrch()
    const { ctx, promptText, reload } = makeCtx({ tasks, orch, promptTextResult: "new title" })

    await renameTaskFlow(ctx, "t1")

    expect(promptText).toHaveBeenCalledWith("old title")
    expect(orch.setTitle).toHaveBeenCalledWith("t1", "new title")
    expect(reload).toHaveBeenCalledTimes(1)
  })

  test("cancelled prompt (empty result) skips the RPC", async () => {
    const tasks = [makeTask({ id: "t1" })]
    const orch = makeOrch()
    const { ctx, reload } = makeCtx({ tasks, orch, promptTextResult: undefined })

    await renameTaskFlow(ctx, "t1")

    expect(orch.setTitle).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  test("RPC failure surfaces a toast and skips reload", async () => {
    const tasks = [makeTask({ id: "t1" })]
    const orch = makeOrch({
      setTitle: vi.fn(async () => {
        throw new Error("boom")
      }),
    })
    const { ctx, notifyError, reload } = makeCtx({ tasks, orch, promptTextResult: "new title" })

    await renameTaskFlow(ctx, "t1")

    expect(notifyError).toHaveBeenCalledWith("Couldn't rename task: boom")
    expect(reload).not.toHaveBeenCalled()
  })

  test("unknown taskId is a no-op", async () => {
    const tasks = [makeTask({ id: "t1" })]
    const orch = makeOrch()
    const { ctx, reload } = makeCtx({ tasks, orch, promptTextResult: "x" })

    await renameTaskFlow(ctx, "nope")

    expect(orch.setTitle).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })
})

describe("renameBranchFlow", () => {
  test("renames the branch and reloads", async () => {
    const tasks = [makeTask({ id: "t1", branch: "kobe/t1" })]
    const orch = makeOrch()
    const { ctx, promptText, reload } = makeCtx({ tasks, orch, promptTextResult: "feature/foo" })

    await renameBranchFlow(ctx, "t1")

    expect(promptText).toHaveBeenCalledWith("kobe/t1", { dialogTitle: "Rename branch", fieldLabel: "branch" })
    expect(orch.setBranch).toHaveBeenCalledWith("t1", "feature/foo")
    expect(reload).toHaveBeenCalledTimes(1)
  })

  test("a `main` (project) row is a no-op — its branch isn't kobe's to rename", async () => {
    const tasks = [makeTask({ id: "m1", kind: "main" })]
    const orch = makeOrch()
    const { ctx, promptText } = makeCtx({ tasks, orch, promptTextResult: "x" })

    await renameBranchFlow(ctx, "m1")

    expect(promptText).not.toHaveBeenCalled()
    expect(orch.setBranch).not.toHaveBeenCalled()
  })

  test("cancelled prompt skips the RPC", async () => {
    const tasks = [makeTask({ id: "t1" })]
    const orch = makeOrch()
    const { ctx, reload } = makeCtx({ tasks, orch, promptTextResult: undefined })

    await renameBranchFlow(ctx, "t1")

    expect(orch.setBranch).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  test("RPC failure surfaces a toast and skips reload", async () => {
    const tasks = [makeTask({ id: "t1" })]
    const orch = makeOrch({
      setBranch: vi.fn(async () => {
        throw new Error("bad branch name")
      }),
    })
    const { ctx, notifyError, reload } = makeCtx({ tasks, orch, promptTextResult: "bad name" })

    await renameBranchFlow(ctx, "t1")

    expect(notifyError).toHaveBeenCalledWith("Couldn't rename branch: bad branch name")
    expect(reload).not.toHaveBeenCalled()
  })
})

describe("cycleVendorFlow", () => {
  test("cycles to the next vendor within the detected set, notifies, and reloads", async () => {
    const tasks = [makeTask({ id: "t1", vendor: "claude" as Task["vendor"] })]
    const orch = makeOrch()
    const { ctx, notifyInfo, reload } = makeCtx({ tasks, orch })

    await cycleVendorFlow(ctx, "t1")

    // account-detect is mocked to ["claude", "codex"] — cycling from claude
    // lands on codex.
    // `undefined` effort = the cycle chord has no opinion on the reasoning
    // level, so the task keeps the one it has.
    expect(orch.setVendor).toHaveBeenCalledWith("t1", "codex", undefined)
    expect(notifyInfo).toHaveBeenCalledWith(expect.stringContaining("applies on reopen"))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  test("RPC failure surfaces a toast and skips the deferred-rebuild notice + reload", async () => {
    const tasks = [makeTask({ id: "t1", vendor: "claude" as Task["vendor"] })]
    const orch = makeOrch({
      setVendor: vi.fn(async () => {
        throw new Error("nope")
      }),
    })
    const { ctx, notifyError, notifyInfo, reload } = makeCtx({ tasks, orch })

    await cycleVendorFlow(ctx, "t1")

    expect(notifyError).toHaveBeenCalledWith("Couldn't switch engine: nope")
    expect(notifyInfo).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  test("unknown taskId is a no-op", async () => {
    const tasks = [makeTask({ id: "t1" })]
    const orch = makeOrch()
    const { ctx } = makeCtx({ tasks, orch })

    await cycleVendorFlow(ctx, "nope")

    expect(orch.setVendor).not.toHaveBeenCalled()
  })

  test("no daemon (orch null) is a no-op", async () => {
    const tasks = [makeTask({ id: "t1" })]
    const { ctx } = makeCtx({ tasks, orch: null })

    await cycleVendorFlow(ctx, "t1")
  })
})

/**
 * The set-status flow. Its whole job is one RPC, so the tests name the FIELD
 * that RPC carries: dropping the `setStatus` call, or sending a stale value,
 * has to turn something red here.
 *
 * The cosmetic contract is asserted as an absence — no other orchestrator
 * method may fire. A status is a board LABEL (`docs/CONCEPTS.md`), and the
 * failure this guards against is a future "canceled should also stop the
 * session" edit quietly turning a relabel into a teardown.
 */
describe("setStatusFlow", () => {
  test("writes the picked status and reloads", async () => {
    const tasks = [makeTask({ id: "t1", status: "in_progress" })]
    const orch = makeOrch()
    const { ctx, pickStatus, notifyInfo, reload } = makeCtx({ tasks, orch, pickStatusResult: "in_review" })

    await setStatusFlow(ctx, "t1")

    expect(pickStatus).toHaveBeenCalledWith("in_progress")
    expect(orch.setStatus).toHaveBeenCalledWith("t1", "in_review")
    expect(notifyInfo).toHaveBeenCalledWith("Status → in_review")
    expect(reload).toHaveBeenCalledTimes(1)
  })

  test("relabels only — no worktree, branch, vendor or title RPC rides along", async () => {
    const tasks = [makeTask({ id: "t1", status: "in_progress" })]
    const orch = makeOrch()
    const { ctx } = makeCtx({ tasks, orch, pickStatusResult: "canceled" })

    await setStatusFlow(ctx, "t1")

    expect(orch.setStatus).toHaveBeenCalledWith("t1", "canceled")
    expect(orch.setBranch).not.toHaveBeenCalled()
    expect(orch.setTitle).not.toHaveBeenCalled()
    expect(orch.setVendor).not.toHaveBeenCalled()
  })

  test("cancelled picker skips the RPC", async () => {
    const tasks = [makeTask({ id: "t1", status: "backlog" })]
    const orch = makeOrch()
    const { ctx, reload } = makeCtx({ tasks, orch, pickStatusResult: undefined })

    await setStatusFlow(ctx, "t1")

    expect(orch.setStatus).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  test("re-picking the current status skips the RPC", async () => {
    const tasks = [makeTask({ id: "t1", status: "done" })]
    const orch = makeOrch()
    const { ctx, reload } = makeCtx({ tasks, orch, pickStatusResult: "done" })

    await setStatusFlow(ctx, "t1")

    expect(orch.setStatus).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  test("RPC failure surfaces a toast and skips reload", async () => {
    const tasks = [makeTask({ id: "t1", status: "backlog" })]
    const orch = makeOrch({
      setStatus: vi.fn(async () => {
        throw new Error("daemon down")
      }),
    })
    const { ctx, notifyError, notifyInfo, reload } = makeCtx({ tasks, orch, pickStatusResult: "error" })

    await setStatusFlow(ctx, "t1")

    expect(notifyError).toHaveBeenCalledWith("Couldn't set status: daemon down")
    expect(notifyInfo).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  /**
   * `done ↔ error` is refused by the orchestrator (`IllegalTransitionError`,
   * task-editor.ts) — a guard written when nothing but code could attempt it
   * ("we still refuse … to surface bad code"). The picker offers all six
   * values, so a person can now walk into it, which makes the toast the only
   * thing standing between them and a silent no-op. Pinned here so that
   * remains true whoever changes the guard next.
   */
  test("a transition the orchestrator refuses reports instead of failing quietly", async () => {
    const tasks = [makeTask({ id: "t1", status: "done" })]
    const orch = makeOrch({
      setStatus: vi.fn(async () => {
        throw new Error("illegal transition for task t1: done -> error")
      }),
    })
    const { ctx, notifyError, reload } = makeCtx({ tasks, orch, pickStatusResult: "error" })

    await setStatusFlow(ctx, "t1")

    expect(notifyError).toHaveBeenCalledWith("Couldn't set status: illegal transition for task t1: done -> error")
    expect(reload).not.toHaveBeenCalled()
  })

  test("a host with no picker adapter never opens one and never writes", async () => {
    const tasks = [makeTask({ id: "t1", status: "backlog" })]
    const orch = makeOrch()
    const { ctx, pickStatus } = makeCtx({ tasks, orch, pickStatusResult: "done", wirePickStatus: false })

    await setStatusFlow(ctx, "t1")

    expect(pickStatus).not.toHaveBeenCalled()
    expect(orch.setStatus).not.toHaveBeenCalled()
  })

  test("unknown taskId is a no-op", async () => {
    const tasks = [makeTask({ id: "t1" })]
    const orch = makeOrch()
    const { ctx, pickStatus } = makeCtx({ tasks, orch, pickStatusResult: "done" })

    await setStatusFlow(ctx, "missing")

    expect(pickStatus).not.toHaveBeenCalled()
    expect(orch.setStatus).not.toHaveBeenCalled()
  })
})

describe("copyTaskFieldFlow", () => {
  test("branch: copies the stored branch verbatim and toasts it", () => {
    const tasks = [makeTask({ id: "t1", branch: "feat/copy" })]
    const { ctx, copyText, notifyInfo } = makeCtx({ tasks, orch: makeOrch() })

    copyTaskFieldFlow(ctx, "t1", "branch")

    expect(copyText).toHaveBeenCalledWith("feat/copy")
    expect(notifyInfo).toHaveBeenCalledTimes(1)
    expect(notifyInfo.mock.calls[0][0]).toContain("feat/copy")
  })

  test("path: copies the RECORDED worktree path — never materializes it", () => {
    // The path may not exist yet (a task opened once never ran ensureWorktree);
    // a copy is a read, so the flow has no orchestrator call to make at all.
    const orch = makeOrch()
    const tasks = [makeTask({ id: "t1", worktreePath: "/wt/not-yet" })]
    const { ctx, copyText } = makeCtx({ tasks, orch })

    copyTaskFieldFlow(ctx, "t1", "path")

    expect(copyText).toHaveBeenCalledWith("/wt/not-yet")
    for (const fn of Object.values(orch)) expect(fn).not.toHaveBeenCalled()
  })

  test("an empty branch (main/dir row) copies nothing and shows no toast", () => {
    const tasks = [makeTask({ id: "t1", branch: "", kind: "main" })]
    const { ctx, copyText, notifyInfo } = makeCtx({ tasks, orch: makeOrch() })

    copyTaskFieldFlow(ctx, "t1", "branch")

    expect(copyText).not.toHaveBeenCalled()
    expect(notifyInfo).not.toHaveBeenCalled()
  })

  test("a host with no clipboard writer is a silent no-op, not a crash", () => {
    const tasks = [makeTask({ id: "t1" })]
    const { ctx, notifyInfo } = makeCtx({ tasks, orch: makeOrch(), wireCopyText: false })

    expect(() => copyTaskFieldFlow(ctx, "t1", "path")).not.toThrow()
    expect(notifyInfo).not.toHaveBeenCalled()
  })
})
