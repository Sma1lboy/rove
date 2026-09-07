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
import { renderComponent } from "./harness"

const ROW = {
  repo: "/x/kobe",
  path: "/x/wt/feature-a",
  branch: "feature-a",
  head: "abc1234",
  dirty: false,
  kobeManaged: true,
  lastActivityMs: 0,
  createdAtMs: 0,
  branchOnRemote: false,
  verdict: "fresh",
  verdictReason: "fresh",
}

function orchestrator(removeWorktree: (path: string, force: boolean) => Promise<void>) {
  return {
    listWorktrees: async () => [{ repo: "/x/kobe", worktrees: [ROW] }],
    listTasks: () => [],
    removeWorktree,
  } as never
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 100))

test("the row disappears before the daemon delete resolves", async () => {
  let release = (): void => {}
  const pending = new Promise<void>((r) => {
    release = r
  })
  const { frame, mockInput } = await renderComponent(
    <WorktreesPage orchestrator={orchestrator(() => pending)} onClose={() => {}} />,
    { width: 70, height: 20, providers: { dialog: true, notifications: true } },
  )
  await settle()
  expect(await frame()).toContain("feature-a")

  mockInput.typeText("d")
  await settle()
  // Danger confirms open focused on Cancel (a stray Enter must not delete) —
  // move right onto the confirm button before committing.
  mockInput.pressArrow("right")
  await settle()
  mockInput.pressEnter() // confirm
  await settle()

  // Daemon call still in flight — the row must already be gone.
  expect(await frame()).not.toContain("feature-a")
  release()
})

test("a failed delete puts the row back", async () => {
  const { frame, mockInput } = await renderComponent(
    <WorktreesPage orchestrator={orchestrator(() => Promise.reject(new Error("boom")))} onClose={() => {}} />,
    { width: 70, height: 20, providers: { dialog: true, notifications: true } },
  )
  await settle()
  mockInput.typeText("d")
  await settle()
  mockInput.pressArrow("right")
  await settle()
  mockInput.pressEnter()
  await settle()
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
  await settle()
  mockInput.typeText("d")
  await settle()
  mockInput.pressArrow("right")
  await settle()
  mockInput.pressEnter() // confirm the ordinary delete
  await settle()

  // The second, more severe confirm — and it names what `git status` cannot.
  const forcePrompt = await frame()
  expect(forcePrompt).toContain("Force delete")
  expect(forcePrompt).toContain("HANDOFF.md")

  mockInput.pressArrow("right")
  await settle()
  mockInput.pressEnter() // authorize the force
  await settle()
  expect(calls).toEqual([false, true])
})
