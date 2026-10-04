/** @jsxImportSource @opentui/react */
/**
 * What a worktree row does and does NOT put in its cells.
 *
 * A real mount rather than a pure assertion for the reason
 * `sidebar-tree-materializing.test.tsx` gives: the claim is "this reaches the
 * frame", and the failure mode of a row-level label is a value that arrives
 * everywhere except the terminal.
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
