/** @jsxImportSource @opentui/react */
/**
 * The Inbox window and its cell budgets, read off real frames:
 *
 *  - clipped cards are SAID ("+N more"), not silently cut — the old window
 *    charged section headers a full card slot, so a trailing RECENT header
 *    dangled with every row under it hidden and nothing saying so;
 *  - clipped labels end in `…` (the sidebar's round-one truncation rule) —
 *    Yoga's bare hard cut reads as the full name;
 *  - when the identity line gets too tight, the state badge drops its label
 *    and keeps the glyph, instead of the label clipping mid-word.
 */

import { expect, test } from "bun:test"
import type { AttentionInboxItem } from "../../src/client/remote-orchestrator"
import type { KVContext } from "../../src/tui-react/context/kv"
import { AttentionInboxPane } from "../../src/tui-react/workspace/AttentionInboxPane"
import { type Task, toTaskId } from "../../src/types/task"
import { renderComponent } from "./harness"

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
  }
}

function item(taskId: string, state: AttentionInboxItem["state"]): AttentionInboxItem {
  return { taskId, tabId: null, state, unread: true, at: Date.now() - 60_000 }
}

function stubKv(): KVContext {
  const store: Record<string, unknown> = {}
  return {
    ready: true,
    store,
    signal: <T,>(name: string, defaultValue: T) => {
      const read = () => (store[name] ?? defaultValue) as T
      const write = (next: T) => {
        store[name] = next
      }
      return [read, write] as const
    },
    get: (key: string, defaultValue?: unknown) => store[key] ?? defaultValue,
    set: (key: string, value: unknown) => {
      store[key] = value
    },
    flush: () => true,
    clear: () => void 0,
  }
}

async function pane(
  items: AttentionInboxItem[],
  tasks: Task[],
  size: { width: number; height: number },
): Promise<string> {
  const { frame } = await renderComponent(
    <AttentionInboxPane
      items={items}
      tasks={tasks}
      kv={stubKv()}
      onOpen={() => {}}
      onOpenTask={() => {}}
      onDelete={() => {}}
      onClose={() => {}}
    />,
    size,
  )
  return await frame()
}

test("clipped cards surface as +N more instead of vanishing", async () => {
  const tasks = Array.from({ length: 9 }, (_, index) => task(`t${index}`))
  const items = tasks.map((entry) => item(entry.id, "turn_complete"))
  const text = await pane(items, tasks, { width: 80, height: 30 })
  // Budget caps at 6 cards; 9 episodes leave 3 unseen below the fold.
  expect(text).toContain("+3 more")
})

test("a long identity ends in an ellipsis, not a bare cut", async () => {
  const tasks = [task("t0", { title: "a-title-that-cannot-possibly-fit-in-forty-columns-of-terminal" })]
  const text = await pane([item("t0", "turn_complete")], tasks, { width: 44, height: 30 })
  expect(text).toContain("…")
})

test("a tight identity line drops the badge label but keeps its glyph", async () => {
  const tasks = [task("t0", { title: "some-reasonably-long-task-title" })]
  const text = await pane([item("t0", "permission_needed")], tasks, { width: 40, height: 30 })
  expect(text).toContain("?")
  expect(text).not.toContain("needs input")
})

test("a comfortable width keeps the full badge label", async () => {
  const tasks = [task("t0")]
  const text = await pane([item("t0", "permission_needed")], tasks, { width: 80, height: 30 })
  expect(text).toContain("needs input")
})
