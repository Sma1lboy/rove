/**
 * The way BACK to a project the sidebar hid.
 *
 * `isClosedDownProject` drops a project whose only row is its main checkout
 * once that checkout's last tab closes. Nothing is deleted, and the repo is
 * meant to be "still there in the new-task picker to open again" — but a
 * submit path through `createTask` mints a `kind: "task"`, so picking the
 * hidden repo would add a worktree beside the project and still produce no
 * project row.
 *
 * `mode: "open"` is the way back. These pin it: the
 * flow calls `ensureMainTask` (idempotent — it RESOLVES the existing main row
 * rather than creating a second one), lands on it, and creates no task.
 */

import { describe, expect, test, vi } from "vitest"

vi.mock("../../src/state/repos", () => ({
  getSavedRepos: () => ["/repos/codefox"],
  addSavedRepo: (path: string) => ({ added: false, path, total: 1 }),
}))
vi.mock("../../src/engine/account-detect", () => ({
  availableEngineIds: async () => ["claude"],
}))

import type { KobeOrchestrator } from "../../src/client/remote-orchestrator"
import type { NewTaskDialogOptions, NewTaskInput } from "../../src/tui/component/new-task-dialog/state"
import { type CreateTaskContext, createTaskFlow } from "../../src/tui/lib/task-create-flow"
import type { Task } from "../../src/types/task"

/** `Task.id` is a branded string; tests name rows with plain literals. */
const task = (over: { id: string; kind?: string; repo?: string }): Task =>
  ({ repo: "/repos/codefox", ...over }) as unknown as Task

/** The hidden project's surviving row: a main task whose tabs are all closed. */
const HIDDEN_MAIN = task({ id: "main-codefox", kind: "main", repo: "/repos/codefox" })

function makeCtx(opts: {
  submit: NewTaskInput | undefined
  tasks?: readonly Task[]
  ensureMainTask?: (repo: string) => Promise<Task>
}) {
  const ensureMainTask = vi.fn(opts.ensureMainTask ?? (async () => HIDDEN_MAIN))
  const createTask = vi.fn(async () => ({ id: "created" }))
  const notifyInfo = vi.fn()
  const notifyError = vi.fn()
  const selectTask = vi.fn()
  const enterTask = vi.fn(async () => {})
  const reload = vi.fn(async () => {})
  const logger = { error: vi.fn() }
  /** What the dialog was handed — the assertion target for the gating half. */
  let seenOptions: NewTaskDialogOptions | undefined
  const ctx: CreateTaskContext = {
    orch: { ensureMainTask, createTask, discoverAdoptableWorktrees: async () => [] } as unknown as KobeOrchestrator,
    tasks: () => opts.tasks ?? [HIDDEN_MAIN],
    confirm: async () => true,
    promptText: async () => undefined,
    logger,
    logPrefix: "[test]",
    notifyInfo,
    notifyError,
    reload,
    selectTask,
    enterTask,
    cursorRepo: () => "/repos/codefox",
    lastVendor: () => "claude" as never,
    rememberVendor: vi.fn(),
    promptNewTask: async (_repo, _repos, options) => {
      seenOptions = options
      return opts.submit
    },
  }
  return {
    ctx,
    ensureMainTask,
    createTask,
    notifyInfo,
    notifyError,
    selectTask,
    enterTask,
    reload,
    logger,
    options: () => seenOptions,
  }
}

const OPEN: NewTaskInput = { mode: "open", repo: "/repos/codefox", vendor: "claude" as never }

describe("createTaskFlow — opening a project instead of branching off it", () => {
  test("resolves the repo's existing main row and enters it", async () => {
    const h = makeCtx({ submit: OPEN })

    await createTaskFlow(h.ctx)

    expect(h.ensureMainTask).toHaveBeenCalledWith("/repos/codefox")
    // The whole point: the hidden project's OWN row comes back, focused.
    expect(h.selectTask).toHaveBeenCalledWith("main-codefox")
    expect(h.enterTask).toHaveBeenCalledWith("main-codefox")
    expect(h.reload).toHaveBeenCalled()
  })

  test("creates no task — that is the bug it exists to fix", async () => {
    // Submitting the same repo through the default path leaves the user with
    // an extra worktree and still no project. Asserting the absence is the
    // only thing that separates the two paths: both end with a task selected.
    const h = makeCtx({ submit: OPEN })

    await createTaskFlow(h.ctx)

    expect(h.createTask).not.toHaveBeenCalled()
  })

  test("does not claim it is creating anything", async () => {
    const h = makeCtx({ submit: OPEN })

    await createTaskFlow(h.ctx)

    expect(h.notifyInfo.mock.calls.map((c) => String(c[0])).join(" ")).not.toMatch(/creating/i)
  })

  test("a failure surfaces instead of closing the dialog on nothing", async () => {
    const h = makeCtx({
      submit: OPEN,
      ensureMainTask: async () => {
        throw new Error("repo is gone")
      },
    })

    await createTaskFlow(h.ctx)

    expect(h.notifyError).toHaveBeenCalledTimes(1)
    expect(String(h.notifyError.mock.calls[0][0])).toContain("repo is gone")
    expect(h.enterTask).not.toHaveBeenCalled()
  })

  test("the default submit still creates a task", async () => {
    // The new mode must not change what the tab does by default — the
    // "branch a worktree off this repo" verb is still the common case.
    const h = makeCtx({
      submit: { repo: "/repos/codefox", baseRef: "main", vendor: "claude" as never },
    })

    await createTaskFlow(h.ctx)

    expect(h.createTask).toHaveBeenCalledTimes(1)
    expect(h.selectTask).toHaveBeenCalledWith("created")
  })
})

describe("which repos the dialog may offer the project choice for", () => {
  test("names a repo that has a main row", async () => {
    const h = makeCtx({ submit: undefined })

    await createTaskFlow(h.ctx)

    expect(h.options()?.mainRepos?.has("/repos/codefox")).toBe(true)
  })

  test("omits a repo whose only rows are worktree tasks", async () => {
    // No main row means no project checkout to open — offering the choice
    // would put a control on the tab whose second option does nothing.
    const h = makeCtx({
      submit: undefined,
      tasks: [task({ id: "a", kind: "task", repo: "/repos/orphan" })],
    })

    await createTaskFlow(h.ctx)

    expect(h.options()?.mainRepos?.has("/repos/orphan")).toBe(false)
  })

  test("matches a repo path recorded with a trailing slash", async () => {
    // The sidebar groups on the slash-trimmed key, so the dialog must too —
    // otherwise a project stored one way is unreachable from a path typed
    // the other way.
    const h = makeCtx({
      submit: undefined,
      tasks: [task({ id: "m", kind: "main", repo: "/repos/codefox/" })],
    })

    await createTaskFlow(h.ctx)

    expect(h.options()?.mainRepos?.has("/repos/codefox")).toBe(true)
  })
})
