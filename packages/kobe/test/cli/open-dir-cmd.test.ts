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
})
