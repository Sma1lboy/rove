/**
 * The workspace host's `renameBranch` guard (host-task-actions.ts): the
 * branch-picker dialog must not even open for task kinds whose branch
 * `setBranch` refuses to touch — a main row tracks the repo's own branch and
 * a dir task tracks its own checkout, so picking a name there could only end
 * in the error toast.
 *
 * The hook is plain wiring (no React hooks in its body), so it runs directly
 * under vitest with the dialog modules mocked — the real BranchPickerDialog
 * drags in `@opentui/core`.
 */

import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  branchPickerShow: vi.fn(),
}))

// The hook's one React import (the renderer the copy flow's OSC52 writer
// needs); the real module drags in react-reconciler.
vi.mock("@opentui/react", () => ({
  useRenderer: () => ({ copyToClipboardOSC52: vi.fn() }),
}))

vi.mock("../../src/tui-react/component/branch-picker-dialog", () => ({
  BranchPickerDialog: { show: mocks.branchPickerShow },
}))
// Not exercised here (see host-task-actions-set-status.test.ts) but imported
// by the module under test, and the real one drags in `@opentui/react`.
vi.mock("../../src/tui-react/component/status-picker-dialog", () => ({
  StatusPickerDialog: { show: vi.fn() },
}))
vi.mock("../../src/tui-react/ui/task-dialog-adapters", () => ({
  buildBaseCreateTaskContext: vi.fn(() => ({})),
  selectNextAfterDelete: vi.fn(() => vi.fn()),
}))

import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import { useWorkspaceTaskActions } from "../../src/tui-react/workspace/host-task-actions"
import { type Task, toTaskId } from "../../src/types/task"

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
  const setBranch = vi.fn(async (_id: string, _branch: string) => {})
  const actions = useWorkspaceTaskActions({
    orchestrator: { setBranch } as unknown as RemoteOrchestrator,
    tasks: () => tasks,
    dialog: {} as never,
    notifyError: vi.fn(),
    notifyInfo: vi.fn(),
    notifyNeedsInput: vi.fn(),
    t: (key: string) => key,
    selectedId: () => null,
    setSelectedId: vi.fn(),
    selectedTask: () => undefined,
    activateTask: vi.fn(async () => {}),
    forgetTaskTabs: vi.fn(),
  })
  return { actions, setBranch }
}

describe("renameBranch (workspace host)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("a worktree task opens the picker and applies the picked branch", async () => {
    mocks.branchPickerShow.mockResolvedValueOnce("feat/renamed")
    const { actions, setBranch } = makeActions([task("a")])
    await actions.renameBranch("a")
    expect(mocks.branchPickerShow).toHaveBeenCalledTimes(1)
    expect(setBranch).toHaveBeenCalledWith("a", "feat/renamed")
  })

  test("a main row never opens the picker (its branch is the repo's own)", async () => {
    const { actions, setBranch } = makeActions([task("m", { kind: "main", branch: "main" })])
    await actions.renameBranch("m")
    expect(mocks.branchPickerShow).not.toHaveBeenCalled()
    expect(setBranch).not.toHaveBeenCalled()
  })

  test("a dir task never opens the picker (it tracks its own checkout)", async () => {
    const { actions, setBranch } = makeActions([task("d", { kind: "dir", branch: "" })])
    await actions.renameBranch("d")
    expect(mocks.branchPickerShow).not.toHaveBeenCalled()
    expect(setBranch).not.toHaveBeenCalled()
  })
})
