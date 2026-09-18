/** @jsxImportSource @opentui/react */
/**
 * The derived task group, in the cells.
 *
 * A real mount rather than a pure assertion for the reason
 * `sidebar-tree-materializing.test.tsx` gives: the claim is "the marker
 * reaches the frame", and the failure mode of a task-level signal on a row
 * built to refuse task-level signals is a value that arrives everywhere
 * except the terminal.
 *
 * Two of these could not be rendered on a worktree row at all before: a
 * task whose worker filed a report and went quiet, and one whose PR was
 * approved. Both are rows the human should act on, and neither is visible in
 * any tab's engine state — which is all the row could read.
 */
import { expect, test } from "bun:test"
import type { RowToken } from "../../src/client/remote-orchestrator"
import { SidebarTree } from "../../src/tui-react/panes/sidebar/SidebarTree"
import { tabsByTask } from "../../src/tui-react/workspace/terminal-tabs-shared"
import { type Task, toTaskId } from "../../src/types/task"
import { renderComponent } from "./harness"

const NOW = Date.now()

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id: toTaskId(id),
    title: id,
    repo: "/repos/rove",
    branch: `fix/${id}`,
    worktreePath: `/wt/${id}`,
    kind: "task",
    status: "in_progress",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  } as Task
}

const APPROVED = {
  provider: "github",
  lifecycle: "open",
  checkState: "passing",
  reviewDecision: "APPROVED",
} as const

async function render(
  tasks: readonly Task[],
  engineState?: ReadonlyMap<string, { state: string; at: number }>,
  rowTokens?: ReadonlyMap<string, readonly RowToken[]>,
): Promise<string> {
  tabsByTask.clear()
  const { frame } = await renderComponent(
    <SidebarTree
      tasks={tasks}
      selectedId={tasks[0]?.id ?? null}
      selectedTabId={null}
      onSelect={() => {}}
      focused={true}
      width={34}
      // biome-ignore lint/suspicious/noExplicitAny: the harness's narrow map shape.
      engineState={engineState as any}
      rowTokens={rowTokens}
    />,
    { width: 34, height: 16 },
  )
  return await frame()
}

test("a blocked task wears the needs-you marker on its worktree row", async () => {
  const text = await render([task("blocked")], new Map([["blocked", { state: "permission_needed", at: NOW }]]))
  expect(text).toContain("! fix/blocked")
})

test("an approved PR wears the ready-to-land marker — the state the rail could not express", async () => {
  const text = await render(
    [task("shipping", { prStatus: APPROVED })],
    new Map([["shipping", { state: "idle", at: NOW }]]),
  )
  expect(text).toContain("» fix/shipping")
})

test("a worker's report with nobody acting on it wears the review marker", async () => {
  const reported = task("reported", {
    report: { branch: "fix/reported", summary: "done", at: new Date(NOW - 60_000).toISOString() },
  })
  const text = await render([reported], new Map([["reported", { state: "idle", at: NOW }]]))
  expect(text).toContain("● fix/reported")
})

test("a quiet row draws no marker and spends none of its label budget on one", async () => {
  const text = await render([task("quiet")], new Map([["quiet", { state: "idle", at: NOW }]]))
  expect(text).toContain("fix/quiet")
  expect(text).not.toContain("! fix/quiet")
  expect(text).not.toContain("● fix/quiet")
  expect(text).not.toContain("» fix/quiet")
})

test("a plugin's row token reaches the cells beside the branch", async () => {
  const tokens = new Map([
    ["claimed", [{ source: "examples.row-tokens", key: "claim", text: "@ana", expiresAt: NOW + 600_000 }]],
  ])
  const text = await render([task("claimed")], new Map([["claimed", { state: "idle", at: NOW }]]), tokens)
  expect(text).toContain("@ana")
})

test("an expired token is gone from the frame without waiting for a push", async () => {
  // The daemon republishes at each expiry, but a frame between the deadline
  // and that push must not paint a label that has already lapsed.
  const tokens = new Map([
    ["claimed", [{ source: "examples.row-tokens", key: "claim", text: "@ana", expiresAt: NOW - 1 }]],
  ])
  const text = await render([task("claimed")], new Map([["claimed", { state: "idle", at: NOW }]]), tokens)
  expect(text).not.toContain("@ana")
})
