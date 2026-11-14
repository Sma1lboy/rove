/** @jsxImportSource @opentui/react */
/**
 * Deleting a worktree removes its row IMMEDIATELY, without waiting for the
 * daemon.
 *
 * `git worktree remove` on a worktree with a populated `node_modules` is
 * seconds of real filesystem work, so `await`ing it before refetching leaves
 * the row sitting there looking hung. These tests pin the optimistic
 * behavior: gone on confirm, back on failure.
 */

import { expect, test } from "bun:test"
import { WorktreesPage } from "../../src/tui-react/component/worktrees-page"
import { act, renderComponent, settle, waitForFrameText } from "./harness"

const ROW = {
  repo: "/x/rove",
  path: "/x/wt/feature-a",
  branch: "feature-a",
  head: "abc1234",
  dirty: false,
  roveManaged: true,
  lastActivityMs: 0,
  createdAtMs: 0,
  branchOnRemote: false,
  verdict: "fresh",
  verdictReason: "fresh",
}

function orchestrator(removeWorktree: (path: string, force: boolean) => Promise<void>) {
  return {
    listWorktrees: async () => [{ repo: "/x/rove", worktrees: [ROW] }],
    listTasks: () => [],
    removeWorktree,
  } as never
}

/** Poll `check` with a cap: the page reaches the orchestrator asynchronously. */
async function until(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check() && Date.now() < deadline) await settle(25)
}

/** Open the delete confirm on the only row and commit it. */
async function confirmDelete(
  frame: () => Promise<string>,
  mockInput: { typeText: (text: string) => void; pressArrow: (dir: "right") => void; pressEnter: () => void },
): Promise<void> {
  await waitForFrameText(frame, "feature-a")
  await act(async () => mockInput.typeText("d"))
  await waitForFrameText(frame, "Delete worktree?")
  // Danger confirms open focused on Cancel (a stray Enter must not delete) —
  // move right onto the confirm button before committing.
  await act(async () => mockInput.pressArrow("right"))
  await act(async () => mockInput.pressEnter())
}

test("landing a Git worktree row finds the task saved with Windows native separators", async () => {
  const preflights: string[] = []
  const orch = Object.assign(
    orchestrator(async () => {}),
    {
      listWorktrees: async () => [
        { repo: "C:/Projects/demo", worktrees: [{ ...ROW, path: "C:/worktrees/feature-a" }] },
      ],
      listTasks: () => [{ id: "windows-task", worktreePath: "C:\\worktrees\\feature-a" }],
      landPreflight: async (taskId: string) => {
        preflights.push(taskId)
        return { refusal: "MAIN_CHECKOUT_DIRTY" }
      },
    },
  )
  const { frame, mockInput } = await renderComponent(<WorktreesPage orchestrator={orch} onClose={() => {}} />, {
    width: 70,
    height: 20,
    providers: { dialog: true, notifications: true },
  })
  await waitForFrameText(frame, "feature-a")
  mockInput.typeText("l")
  await until(() => preflights.length > 0)
  expect(preflights).toEqual(["windows-task"])
})

test("the row disappears before the daemon delete resolves", async () => {
  let release = (): void => {}
  const pending = new Promise<void>((r) => {
    release = r
  })
  const { frame, mockInput } = await renderComponent(
    <WorktreesPage orchestrator={orchestrator(() => pending)} onClose={() => {}} />,
    { width: 70, height: 20, providers: { dialog: true, notifications: true } },
  )
  await confirmDelete(frame, mockInput)

  // Daemon call still in flight — the row must already be gone.
  expect(await frame()).not.toContain("feature-a")
  release()
})

test("a failed delete puts the row back", async () => {
  let removes = 0
  const remove = (): Promise<void> => {
    removes++
    return Promise.reject(new Error("boom"))
  }
  const { frame, mockInput } = await renderComponent(
    <WorktreesPage orchestrator={orchestrator(remove)} onClose={() => {}} />,
    { width: 70, height: 20, providers: { dialog: true, notifications: true } },
  )
  await confirmDelete(frame, mockInput)
  await until(() => removes > 0)
  // Let the rejection settle before reading the row back.
  await act(async () => {})
  expect(await frame()).toContain("feature-a")
})

/**
 * `GitWorktreeManager.remove` refuses in three ways, and only ONE of them said
 * "refusing to remove dirty worktree" — the prose the page used to match. A
 * worktree whose only work is gitignored (a `HANDOFF.md`, a `.scratch/`) hits
 * the other refusal, so it never reached the force re-prompt: red toast, row
 * back, and no way to get to the two-stage flow `docs/WORKTREES.md` documents.
 *
 * The page now discriminates on `DIRTY_WORKTREE`, the same test the task-row
 * delete uses (`tui/lib/task-actions.ts`) for the other half of this one event.
 */
test("a gitignored-work refusal opens the force re-prompt, naming the paths", async () => {
  const calls: boolean[] = []
  const remove = (_path: string, force: boolean): Promise<void> => {
    calls.push(force)
    return force
      ? Promise.resolve()
      : Promise.reject(
          new Error("DIRTY_WORKTREE: /x/wt/feature-a has gitignored work git status cannot see: HANDOFF.md"),
        )
  }
  const { frame, mockInput } = await renderComponent(
    <WorktreesPage orchestrator={orchestrator(remove)} onClose={() => {}} />,
    { width: 70, height: 24, providers: { dialog: true, notifications: true } },
  )
  await confirmDelete(frame, mockInput)

  // The second, more severe confirm — and it names what `git status` cannot.
  const forcePrompt = await waitForFrameText(frame, "Force delete")
  expect(forcePrompt).toContain("HANDOFF.md")

  await act(async () => mockInput.pressArrow("right"))
  await act(async () => mockInput.pressEnter()) // authorize the force
  await until(() => calls.length === 2)
  expect(calls).toEqual([false, true])
})
