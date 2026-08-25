/**
 * Plugin file-handler dispatch (`src/tui-react/workspace/plugin-file-open.ts`).
 *
 * The consumer (`use-file-open-actions`) mocks this module, so this is the
 * only place the real implementation runs: it asks the daemon plugin registry
 * whether a file handler claims the basename, and if so fires the handler
 * action through a detached CLI spawn.
 */

import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findFileHandler: vi.fn(),
  kobeCliInvocation: vi.fn(() => ["rove"]),
  spawnDetached: vi.fn(() => true),
}))

vi.mock("@sma1lboy/kobe-daemon/plugins/settings-env", () => ({
  findFileHandler: mocks.findFileHandler,
}))

vi.mock("../../src/cli/invocation", () => ({
  kobeCliInvocation: mocks.kobeCliInvocation,
}))

vi.mock("../../src/lib/spawn-detached", () => ({
  spawnDetached: mocks.spawnDetached,
}))

const { tryPluginFileOpen } = await import("../../src/tui-react/workspace/plugin-file-open.ts")

beforeEach(() => {
  vi.clearAllMocks()
  mocks.kobeCliInvocation.mockReturnValue(["rove"])
})

describe("tryPluginFileOpen", () => {
  test("returns false when the registry throws", () => {
    mocks.findFileHandler.mockImplementation(() => {
      throw new Error("bad registry")
    })
    expect(tryPluginFileOpen("/wt/video.mp4")).toBe(false)
    expect(mocks.spawnDetached).not.toHaveBeenCalled()
  })

  test("returns false when no handler claims the file", () => {
    mocks.findFileHandler.mockReturnValue(null)
    expect(tryPluginFileOpen("/wt/plain.txt")).toBe(false)
    expect(mocks.spawnDetached).not.toHaveBeenCalled()
  })

  test("spawns the handler action and returns spawnDetached's result", () => {
    mocks.findFileHandler.mockReturnValue({ qualifiedAction: "examples.video:open" })
    mocks.spawnDetached.mockReturnValue(true)

    expect(tryPluginFileOpen("/wt/video.mp4")).toBe(true)
    expect(mocks.spawnDetached).toHaveBeenCalledWith(
      "rove",
      ["plugin", "action", "invoke", "examples.video:open", "/wt/video.mp4"],
      { onError: expect.any(Function) },
    )
  })

  test("propagates a spawn failure", () => {
    mocks.findFileHandler.mockReturnValue({ qualifiedAction: "examples.video:open" })
    mocks.spawnDetached.mockReturnValue(false)

    expect(tryPluginFileOpen("/wt/video.mp4")).toBe(false)
  })
})
