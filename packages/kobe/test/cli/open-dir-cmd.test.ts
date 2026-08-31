/**
 * `kobe <path>` — directory-open gesture. Tests the routing predicate and
 * both execution branches: daemon-handoff vs in-process orchestrator.
 */

import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  statSync: vi.fn(),
  connectIfRunning: vi.fn(),
  writeLastActiveTaskId: vi.fn(),
  publishKobeTerminalTitle: vi.fn(),
  startTui: vi.fn(),
  /** Git toplevel of the opened dir. Equal to the dir = it IS a repo root. */
  repoRootOf: vi.fn((p: string) => p),
  isGitRepo: vi.fn(() => false),
  ensureMainTask: vi.fn(async (repo: string) => ({ id: 456, kind: "main", repo })),
}))

vi.mock("../../src/state/repos.ts", () => ({
  resolveRepoRoot: mocks.repoRootOf,
  isGitRepo: mocks.isGitRepo,
}))

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return { ...actual, statSync: mocks.statSync }
})
vi.mock("@sma1lboy/kobe-daemon/client/daemon-process", () => ({
  connectIfRunning: mocks.connectIfRunning,
}))
vi.mock("../../src/state/last-active.ts", () => ({
  writeLastActiveTaskId: mocks.writeLastActiveTaskId,
}))
vi.mock("../../src/tui/lib/outer-terminal-title.ts", () => ({
  publishKobeTerminalTitle: mocks.publishKobeTerminalTitle,
}))
vi.mock("../../src/tui/index.tsx", () => ({
  startTui: mocks.startTui,
}))

vi.mock("../../src/orchestrator/index/store.ts", () => ({
  TaskIndexStore: class {
    async load() {}
  },
}))
vi.mock("../../src/orchestrator/worktree/manager.ts", () => ({ GitWorktreeManager: class {} }))
vi.mock("../../src/orchestrator/core.ts", () => ({
  Orchestrator: class {
    async openDirectoryTask(args: { dir: string }) {
      return { id: 123, dir: args.dir }
    }
    ensureMainTask(repo: string) {
      return mocks.ensureMainTask(repo)
    }
  },
}))

import { isPathLikeArg, runOpenDirectory } from "../../src/cli/open-dir-cmd.ts"

let exitSpy: MockInstance<typeof process.exit>
let stderrSpy: MockInstance<typeof process.stderr.write>

beforeEach(() => {
  let exited = false
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    if (exited) return undefined as never
    exited = true
    throw new Error(`process.exit(${code})`)
  }) as never)
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
  mocks.statSync.mockReset()
  mocks.connectIfRunning.mockReset().mockResolvedValue(null)
  mocks.writeLastActiveTaskId.mockReset()
  mocks.publishKobeTerminalTitle.mockReset()
  mocks.startTui.mockReset().mockResolvedValue(undefined)
  // Default: not a repo — the dir-task path every pre-existing test expects.
  mocks.repoRootOf.mockReset().mockImplementation((p: string) => p)
  mocks.isGitRepo.mockReset().mockReturnValue(false)
  mocks.ensureMainTask.mockReset().mockImplementation(async (repo: string) => ({ id: 456, kind: "main", repo }))
})

afterEach(() => {
  exitSpy.mockRestore()
  stderrSpy.mockRestore()
  vi.clearAllMocks()
})

describe("isPathLikeArg", () => {
  it.each([
    [".", true],
    ["..", true],
    ["./x", true],
    ["../x", true],
    ["/abs/path", true],
    ["~", true],
    ["~/x", true],
    ["statsu", false],
    ["add", false],
    ["x/y", false],
  ])("%s → %s", (arg, expected) => {
    expect(isPathLikeArg(arg)).toBe(expected)
  })
})

describe("runOpenDirectory", () => {
  it("exits 1 when the argument is not a directory", async () => {
    mocks.statSync.mockImplementation(() => {
      throw new Error("ENOENT")
    })
    await expect(runOpenDirectory("./missing")).rejects.toThrow("process.exit(1)")
    expect(stderrSpy.mock.calls.some((c) => String(c[0]).includes('"./missing" is not a directory'))).toBe(true)
  })

  it("exits 1 when the argument is a file", async () => {
    mocks.statSync.mockReturnValue({ isDirectory: () => false })
    await expect(runOpenDirectory("./file.txt")).rejects.toThrow("process.exit(1)")
  })

  it("uses the running daemon when one is available", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({ taskId: "daemon-task-1" }),
      close: vi.fn(),
    }
    mocks.connectIfRunning.mockResolvedValue(client)
    mocks.statSync.mockReturnValue({ isDirectory: () => true })

    await runOpenDirectory("./my-dir")

    expect(client.request).toHaveBeenCalledWith("task.openDir", { dir: expect.stringContaining("my-dir") })
    expect(client.request).toHaveBeenCalledWith("task.setActive", { taskId: "daemon-task-1" })
    expect(client.close).toHaveBeenCalled()
    expect(mocks.publishKobeTerminalTitle).toHaveBeenCalled()
    expect(mocks.startTui).toHaveBeenCalled()
    expect(mocks.writeLastActiveTaskId).not.toHaveBeenCalled()
  })

  it("falls back to the in-process orchestrator when the daemon is not running", async () => {
    mocks.connectIfRunning.mockResolvedValue(null)
    mocks.statSync.mockReturnValue({ isDirectory: () => true })

    await runOpenDirectory("./local-dir")

    expect(mocks.writeLastActiveTaskId).toHaveBeenCalledWith("123")
    expect(mocks.publishKobeTerminalTitle).toHaveBeenCalled()
    expect(mocks.startTui).toHaveBeenCalled()
  })

  describe("a git repo ROOT opens as the project (owner call 2026-08-31)", () => {
    /** The opened dir is its own git toplevel = a repo root. */
    function asRepoRoot(): void {
      mocks.statSync.mockReturnValue({ isDirectory: () => true })
      mocks.isGitRepo.mockReturnValue(true)
      mocks.repoRootOf.mockImplementation((p: string) => p)
    }

    it("ensures the project's main row instead of a throwaway dir task", async () => {
      asRepoRoot()
      mocks.connectIfRunning.mockResolvedValue(null)

      await runOpenDirectory("./my-repo")

      // The row the sidebar shows as the PROJECT — not a `dir` task beside it.
      expect(mocks.ensureMainTask).toHaveBeenCalledWith(expect.stringContaining("my-repo"))
      expect(mocks.writeLastActiveTaskId).toHaveBeenCalledWith("456")
    })

    it("routes through task.ensureMain over a running daemon", async () => {
      asRepoRoot()
      const client = {
        request: vi.fn().mockResolvedValue({ task: { id: "daemon-main-1" } }),
        close: vi.fn(),
      }
      mocks.connectIfRunning.mockResolvedValue(client)

      await runOpenDirectory("./my-repo")

      expect(client.request).toHaveBeenCalledWith("task.ensureMain", {
        repo: expect.stringContaining("my-repo"),
      })
      expect(client.request).toHaveBeenCalledWith("task.setActive", { taskId: "daemon-main-1" })
      expect(client.request).not.toHaveBeenCalledWith("task.openDir", expect.anything())
    })

    it("keeps the dir task for a SUBDIRECTORY of a repo", async () => {
      // Opening `my-repo/packages/app` must not silently re-target the whole
      // monorepo — and must not mint a project named after a subdirectory.
      mocks.statSync.mockReturnValue({ isDirectory: () => true })
      mocks.isGitRepo.mockReturnValue(true)
      mocks.repoRootOf.mockImplementation(() => "/somewhere/my-repo")
      mocks.connectIfRunning.mockResolvedValue(null)

      await runOpenDirectory("./my-repo/packages/app")

      expect(mocks.ensureMainTask).not.toHaveBeenCalled()
      expect(mocks.writeLastActiveTaskId).toHaveBeenCalledWith("123")
    })

    it("keeps the dir task for a repo at a path that cannot be a project", async () => {
      // A real checkout inside `.dev-sandbox` — the shape that leaked.
      mocks.statSync.mockReturnValue({ isDirectory: () => true })
      mocks.isGitRepo.mockReturnValue(true)
      mocks.repoRootOf.mockImplementation((p: string) => p)
      mocks.connectIfRunning.mockResolvedValue(null)

      await runOpenDirectory("/tmp/x/.dev-sandbox/fake-repo")

      expect(mocks.ensureMainTask).not.toHaveBeenCalled()
      expect(mocks.writeLastActiveTaskId).toHaveBeenCalledWith("123")
    })
  })
})
