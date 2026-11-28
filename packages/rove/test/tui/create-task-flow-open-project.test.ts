/**
 * Opening a project's own checkout from the new-task picker.
 *
 * A submit path through `createTask` mints a `kind: "task"` with a worktree.
 * `mode: "open"` instead saves the project (`ensureProject`) and starts a new
 * session in the checkout itself (`openDirectoryTask`), then lands on it.
 */

import { beforeEach, describe, expect, test, vi } from "vitest"

const saved = vi.hoisted(() => ({ repos: ["/repos/codefox"] }))
vi.mock("@sma1lboy/rove-core/state/repos.ts", () => ({
  getSavedRepos: () => saved.repos,
  addSavedRepo: (path: string) => ({ added: false, path, total: 1 }),
}))
vi.mock("@sma1lboy/rove-core/engine/account-detect.ts", () => ({
  availableEngineIds: async () => ["claude"],
}))

import type { RoveOrchestrator } from "@sma1lboy/rove-client/client/remote-orchestrator.ts"
import type { Task } from "@sma1lboy/rove-core/types/task.ts"
import type { NewTaskDialogOptions, NewTaskInput } from "../../src/tui/component/new-task-dialog/state"
import { type CreateTaskContext, createTaskFlow } from "../../src/tui/lib/task-create-flow"

/** `Task.id` is a branded string; tests name rows with plain literals. */
const SESSION = { id: "session-codefox", kind: "dir", repo: "/repos/codefox" } as unknown as Task

function makeCtx(opts: { submit: NewTaskInput | undefined; ensureProject?: (repo: string) => Promise<string> }) {
  const ensureProject = vi.fn(opts.ensureProject ?? (async (repo: string) => repo))
  const openDirectoryTask = vi.fn(async (_opts: { dir: string; vendor?: string }) => SESSION)
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
    orch: {
      ensureProject,
      openDirectoryTask,
      createTask,
      discoverAdoptableWorktrees: async () => [],
    } as unknown as RoveOrchestrator,
    tasks: () => [],
    confirm: async () => true,
    promptText: async () => undefined,
    logger,
    logPrefix: "[test]",
    notifyInfo,
    notifyError,
    reload,
    selectTask,
    enterTask,
    lastVendor: () => "claude" as never,
    rememberVendor: vi.fn(),
    promptNewTask: async (_repo, _repos, options) => {
      seenOptions = options
      return opts.submit
    },
  }
  return {
    ctx,
    ensureProject,
    openDirectoryTask,
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
  test("starts a session in the repo's own checkout and enters it", async () => {
    const h = makeCtx({ submit: OPEN })

    await createTaskFlow(h.ctx)

    expect(h.ensureProject).toHaveBeenCalledWith("/repos/codefox")
    expect(h.openDirectoryTask).toHaveBeenCalledWith({ dir: "/repos/codefox", vendor: "claude" })
    expect(h.selectTask).toHaveBeenCalledWith("session-codefox")
    expect(h.enterTask).toHaveBeenCalledWith("session-codefox")
    expect(h.reload).toHaveBeenCalled()
  })

  test("creates no task — that is the bug it exists to fix", async () => {
    // Asserting the absence is the only thing that separates this path from
    // the default one: both end with a task selected.
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
      ensureProject: async () => {
        throw new Error("repo is gone")
      },
    })

    await createTaskFlow(h.ctx)

    expect(h.notifyError).toHaveBeenCalledTimes(1)
    expect(String(h.notifyError.mock.calls[0][0])).toContain("repo is gone")
    expect(h.openDirectoryTask).not.toHaveBeenCalled()
    expect(h.enterTask).not.toHaveBeenCalled()
  })
})

describe("which repos the dialog may offer the project choice for", () => {
  beforeEach(() => {
    saved.repos = ["/repos/codefox"]
  })

  test("names a saved project", async () => {
    const h = makeCtx({ submit: undefined })

    await createTaskFlow(h.ctx)

    expect(h.options()?.mainRepos?.has("/repos/codefox")).toBe(true)
    expect(h.options()?.mainRepos?.has("/repos/orphan")).toBe(false)
  })

  test("matches a repo path saved with a trailing slash", async () => {
    // The sidebar groups on the slash-trimmed key, so the dialog must too —
    // otherwise a project stored one way is unreachable from a path typed
    // the other way.
    saved.repos = ["/repos/codefox/"]
    const h = makeCtx({ submit: undefined })

    await createTaskFlow(h.ctx)

    expect(h.options()?.mainRepos?.has("/repos/codefox")).toBe(true)
  })
})
