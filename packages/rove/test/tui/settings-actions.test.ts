import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  clear: vi.fn(),
  confirm: vi.fn(),
  destroySafely: vi.fn(),
  hasRestartable: vi.fn(),
  removeTasks: vi.fn(),
  relaunch: vi.fn(),
}))

vi.mock("../../src/tui/component/settings-dialog/actions-core", () => ({
  destroyRendererSafely: mocks.destroySafely,
  hasRestartableDaemon: mocks.hasRestartable,
  removeTasksFileForReset: mocks.removeTasks,
}))

vi.mock("../../src/tui-react/ui/dialog-confirm", () => ({
  DialogConfirm: { show: mocks.confirm },
}))

// The real one replaces the process image. Mocked, so the assertions below can
// be about WHAT a restart does rather than about surviving it.
vi.mock("../../src/cli/self-relaunch", () => ({
  relaunchSelf: mocks.relaunch,
}))

import { confirmResetState, confirmRestartDaemon } from "../../src/tui-react/component/settings-dialog/actions.ts"

let exitSpy: MockInstance<typeof process.exit>
let stderrSpy: MockInstance<typeof process.stderr.write>

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.hasRestartable.mockReturnValue(true)
  mocks.clear.mockReturnValue(true)
  exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
})

afterEach(() => {
  exitSpy.mockRestore()
  stderrSpy.mockRestore()
})

describe("React settings actions", () => {
  it("confirms the canonical Rove paths before resetting state", async () => {
    mocks.confirm.mockResolvedValue(true)
    const renderer = { destroy: vi.fn() }

    await confirmResetState({} as never, { clear: mocks.clear } as never, renderer)

    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.anything(),
      "Reset UI state?",
      expect.stringContaining("~/.config/rove/state.json and ~/.rove/tasks.json"),
      "cancel",
      undefined,
      { danger: true },
    )
    expect(mocks.clear).toHaveBeenCalledTimes(1)
    expect(mocks.removeTasks).toHaveBeenCalledTimes(1)
    expect(mocks.destroySafely).toHaveBeenCalledWith(renderer, "reset")
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it("leaves state alone when reset is cancelled", async () => {
    mocks.confirm.mockResolvedValue(false)
    await confirmResetState({} as never, { clear: mocks.clear } as never, null)
    expect(mocks.clear).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it("a failed settings clear reports the error and stops every later reset step", async () => {
    mocks.confirm.mockResolvedValue(true)
    mocks.clear.mockReturnValue(false)
    await confirmResetState({} as never, { clear: mocks.clear } as never, { destroy: vi.fn() })
    expect(mocks.removeTasks).not.toHaveBeenCalled()
    expect(mocks.destroySafely).not.toHaveBeenCalled()
    expect(stderrSpy).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()
    expect(mocks.confirm).toHaveBeenLastCalledWith(
      expect.anything(),
      "UI state was not reset",
      expect.stringContaining("Your settings and tasks have been kept"),
      "cancel",
    )
  })

  // "Restart backend" has to do BOTH halves or it is not a restart: the old
  // version destroyed the renderer and exited, leaving the user to type `rove`
  // again — which never reloaded the client's own code, the half this row's dev
  // loop (edit daemon code, see it run) actually needs reloaded.
  it("stops the daemon and relaunches this process after confirmation", async () => {
    mocks.confirm.mockResolvedValue(true)
    const renderer = { destroy: vi.fn() }
    const orchestrator = { restartDaemon: vi.fn().mockResolvedValue(undefined) }

    await confirmRestartDaemon({} as never, orchestrator as never, renderer)

    expect(orchestrator.restartDaemon).toHaveBeenCalledTimes(1)
    expect(mocks.relaunch).toHaveBeenCalledWith({ renderer, notice: expect.any(String) })
    // The relaunch owns the teardown now — a second destroy here would race it.
    expect(mocks.destroySafely).not.toHaveBeenCalled()
    // And it must not exit on its own: exiting before the successor is spawned
    // is exactly the old bug, minus the explanation.
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it("does nothing at all without a restartable daemon", async () => {
    mocks.hasRestartable.mockReturnValue(false)
    mocks.confirm.mockResolvedValue(true)
    await confirmRestartDaemon({} as never, undefined, { destroy: vi.fn() })
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.relaunch).not.toHaveBeenCalled()
  })

  // Declining is the only way back out, so it has to leave BOTH halves alone —
  // a stopped daemon with no relaunch behind it is worse than doing nothing.
  it("leaves the daemon running when the restart is cancelled", async () => {
    mocks.confirm.mockResolvedValue(false)
    const orchestrator = { restartDaemon: vi.fn() }
    await confirmRestartDaemon({} as never, orchestrator as never, { destroy: vi.fn() })
    expect(orchestrator.restartDaemon).not.toHaveBeenCalled()
    expect(mocks.relaunch).not.toHaveBeenCalled()
  })
})
