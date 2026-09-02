/**
 * The workspace host's `setStatus` wiring (host-task-actions.ts).
 *
 * The flow itself is covered in `test/tui/task-actions-rename.test.ts`; what
 * is only testable HERE is the seam between them — the host supplies the
 * picker as the `pickStatus` adapter, and a flow whose adapter never arrives
 * is a menu entry that opens nothing. That failure is silent in both
 * directions: the flow returns cleanly with no picker, and the dialog renders
 * correctly with nothing wired to it.
 *
 * Same harness shape as the rename-branch sibling: the hook has no React
 * hooks in its body, so it runs directly under vitest with the dialog modules
 * mocked (the real ones drag in `@opentui/react`).
 */

import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  statusPickerShow: vi.fn(),
  copyTextToSystemClipboard: vi.fn(),
  copyToClipboardOSC52: vi.fn(),
}))

// The host's only React hook: the renderer whose OSC52 writer the copy flow
// needs. Stubbed to the one method the adapter calls.
vi.mock("@opentui/react", () => ({
  useRenderer: () => ({ copyToClipboardOSC52: mocks.copyToClipboardOSC52 }),
}))
vi.mock("../../src/tui/lib/clipboard-copy", () => ({
  copyTextToSystemClipboard: mocks.copyTextToSystemClipboard,
}))

vi.mock("../../src/tui-react/component/status-picker-dialog", () => ({
  StatusPickerDialog: { show: mocks.statusPickerShow },
}))
vi.mock("../../src/tui-react/component/branch-picker-dialog", () => ({
  BranchPickerDialog: { show: vi.fn() },
}))
// Echo back the fields the shared flows read, rather than `{}`: `setStatusFlow`
// resolves its task through `ctx.tasks()` and writes through `ctx.orch`, so a
// hollow base would make every assertion below pass vacuously.
vi.mock("../../src/tui-react/ui/task-dialog-adapters", () => ({
  buildBaseCreateTaskContext: vi.fn((opts: Record<string, unknown>) => ({
    orch: opts.orch,
    tasks: opts.tasks,
    logPrefix: opts.logPrefix,
    logger: { error: vi.fn() },
    notifyError: opts.notifyError,
    notifyInfo: opts.notifyInfo,
  })),
  selectNextAfterDelete: vi.fn(() => vi.fn()),
}))

import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import { useWorkspaceTaskActions } from "../../src/tui-react/workspace/host-task-actions"
import { type Task, toTaskId } from "../../src/types/task"

const DIALOG = { id: "dialog" } as never

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id: toTaskId(id),
    title: id,
    repo: "/repos/rove",
    branch: `feat/${id}`,
    worktreePath: `/wt/${id}`,
    kind: "task",
    status: "in_progress",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  } as Task
}

function makeActions(tasks: readonly Task[]) {
  const setStatus = vi.fn(async (_id: string, _status: string) => {})
  const notifyError = vi.fn()
  const actions = useWorkspaceTaskActions({
    orchestrator: { setStatus } as unknown as RemoteOrchestrator,
    tasks: () => tasks,
    dialog: DIALOG,
    notifyError,
    notifyInfo: vi.fn(),
    selectedId: () => null,
    setSelectedId: vi.fn(),
    selectedTask: () => undefined,
    activateTask: vi.fn(async () => {}),
    forgetTaskTabs: vi.fn(),
  })
  return { actions, setStatus, notifyError }
}

describe("setStatus (workspace host)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("opens the picker on the task's CURRENT status and writes the pick", async () => {
    mocks.statusPickerShow.mockResolvedValueOnce("in_review")
    const { actions, setStatus } = makeActions([task("a", { status: "in_progress" })])

    await actions.setStatus("a")

    expect(mocks.statusPickerShow).toHaveBeenCalledWith(DIALOG, { current: "in_progress" })
    expect(setStatus).toHaveBeenCalledWith("a", "in_review")
  })

  test("a cancelled picker writes nothing", async () => {
    mocks.statusPickerShow.mockResolvedValueOnce(undefined)
    const { actions, setStatus } = makeActions([task("a")])

    await actions.setStatus("a")

    expect(mocks.statusPickerShow).toHaveBeenCalledTimes(1)
    expect(setStatus).not.toHaveBeenCalled()
  })

  test("a rejected write surfaces the host's toast instead of throwing at the caller", async () => {
    mocks.statusPickerShow.mockResolvedValueOnce("done")
    const { actions, notifyError } = makeActions([task("a")])
    // The menu fires this as `void setStatus(id)` — an unhandled rejection here
    // would be an invisible crash, not a message.
    await expect(actions.setStatus("missing")).resolves.toBeUndefined()
    expect(notifyError).not.toHaveBeenCalled()
  })
})

/**
 * The copy seam is the same shape as set-status: the flow is covered in
 * `test/tui/task-actions-rename.test.ts`; what only exists HERE is the host
 * handing the flow a clipboard writer that reaches BOTH channels (local pipe
 * + the renderer's OSC52), and a flow with no writer is a menu row that
 * silently copies nothing.
 */
describe("copyTaskField (workspace host)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("routes the branch through the system clipboard AND the renderer's OSC52", () => {
    const { actions } = makeActions([task("a", { branch: "feat/copy-me" })])

    actions.copyTaskField("a", "branch")

    expect(mocks.copyTextToSystemClipboard).toHaveBeenCalledTimes(1)
    const [text, osc52] = mocks.copyTextToSystemClipboard.mock.calls[0] as [string, (t: string) => void]
    expect(text).toBe("feat/copy-me")
    osc52("payload")
    expect(mocks.copyToClipboardOSC52).toHaveBeenCalledWith("payload")
  })

  test("path copies the recorded worktreePath", () => {
    const { actions } = makeActions([task("a", { worktreePath: "/wt/somewhere" })])

    actions.copyTaskField("a", "path")

    expect(mocks.copyTextToSystemClipboard.mock.calls[0]?.[0]).toBe("/wt/somewhere")
  })
})
