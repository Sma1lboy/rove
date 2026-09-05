/** @jsxImportSource @opentui/react */
/**
 * The LAST MILE of moving a card: the board page turning the drawer's chosen
 * status into a store write.
 *
 * `issue-detail-status-field.test.tsx` proves the drawer reaches the field
 * and carries the choice out; this proves the page acts on it. They are
 * genuinely separate failures — a drawer that reports `status: "done"` into a
 * page that drops it looks, from the board, exactly like a drawer that never
 * offered the field.
 *
 * Status is its own store op: the `update` op carries title/body/taskId and
 * nothing else, so a status move has to go through `setStatus` or it is lost.
 */

import { expect, test } from "bun:test"
import { KanbanPage } from "../../src/tui-react/component/kanban-page"
import { act, renderComponent, settle } from "./harness"

const REPO = "/repos/rove"
const STORY = { id: 1, title: "Drop the retry loop", status: "open", created: "2026-08-01", body: "" }

function mountBoard() {
  const mutations: unknown[] = []
  const orchestrator = {
    listTasks: () => [],
    listIssueRepos: async () => [REPO],
    listIssues: async () => ({ repoRoot: REPO, exists: true, nextId: 99, issues: [STORY] }),
    activeTaskSignal: () => ({ get: () => null }),
    mutateIssue: async (_repo: string, op: unknown) => {
      mutations.push(op)
      return { repoRoot: REPO, exists: true, nextId: 99, issues: [STORY] }
    },
  } as never

  return { mutations, orchestrator }
}

async function board() {
  const { mutations, orchestrator } = mountBoard()
  const handle = await renderComponent(
    <KanbanPage
      orchestrator={orchestrator}
      focused={true}
      onClose={() => {}}
      onStartChat={async () => {}}
      onOpenTask={() => {}}
    />,
    { width: 120, height: 40, providers: { dialog: true, kv: true, notifications: true } },
  )
  await settle()
  return { ...handle, mutations }
}

test("the drawer's status choice reaches the store as a setStatus op", async () => {
  const { frame, mockInput, mutations } = await board()

  // Select the card and open its drawer.
  act(() => mockInput.pressArrow("right"))
  act(() => mockInput.pressEnter())
  await settle()
  expect(await frame()).toContain("STATUS")

  // Focus opens on WORKSPACE for a startable story; tab wraps round to it.
  for (let i = 0; i < 4; i++) act(() => mockInput.pressTab())
  act(() => mockInput.pressArrow("right"))
  act(() => mockInput.pressEscape())
  await settle()

  // `update` carries title/body/taskId only — a status move that rode it
  // would be silently dropped by the store.
  expect(mutations).toEqual([{ type: "setStatus", id: 1, status: "doing" }])
})

test("closing the drawer without touching status writes nothing", async () => {
  // The page compares against the OPEN-TIME snapshot precisely so a close
  // never races an agent's `issue-set-status` and reverts it.
  const { frame, mockInput, mutations } = await board()
  act(() => mockInput.pressArrow("right"))
  act(() => mockInput.pressEnter())
  await settle()
  expect(await frame()).toContain("STATUS")

  act(() => mockInput.pressEscape())
  await settle()
  expect(mutations).toEqual([])
})
