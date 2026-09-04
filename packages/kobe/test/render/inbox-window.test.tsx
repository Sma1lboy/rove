/** @jsxImportSource @opentui/react */
/**
 * The Inbox window and its cell budgets, read off real frames:
 *
 *  - clipped cards are SAID ("+N more"), not silently cut — charging section
 *    headers a full card slot leaves a trailing RECENT header dangling with
 *    every row under it hidden and nothing saying so;
 *  - clipped labels end in `…` (the sidebar's round-one truncation rule) —
 *    Yoga's bare hard cut reads as the full name;
 *  - when the identity line gets too tight, the state badge drops its label
 *    and keeps the glyph, instead of the label clipping mid-word.
 */

import { expect, test } from "bun:test"
import { TextAttributes } from "@opentui/core"
import type { AttentionInboxItem } from "../../src/client/remote-orchestrator"
import type { KVContext } from "../../src/tui-react/context/kv"
import { AttentionInboxPane } from "../../src/tui-react/workspace/AttentionInboxPane"
import { writeInboxVisit } from "../../src/tui-react/workspace/inbox-visits"
import { type Task, toTaskId } from "../../src/types/task"
import { renderComponent, settle } from "./harness"

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

test("the clear hint dims on a RECENT row — only attention rows are dismissible", async () => {
  const tasks = [task("t-att"), task("t-recent")]
  const items = [item("t-att", "turn_complete")]
  const kv = stubKv()
  writeInboxVisit(kv, { taskId: toTaskId("t-recent"), tabId: null, at: Date.now() - 30_000 })
  const { mockInput, spans } = await renderComponent(
    <AttentionInboxPane
      items={items}
      tasks={tasks}
      kv={kv}
      onOpen={() => {}}
      onOpenTask={() => {}}
      onDelete={() => {}}
      onClose={() => {}}
    />,
    { width: 80, height: 30 },
  )

  const clearHintAttrs = async (): Promise<number> => {
    const hint = (await spans()).lines.flatMap((line) => line.spans).find((span) => span.text.includes("d clear"))
    if (!hint) throw new Error("clear hint missing from the frame")
    return hint.attributes ?? 0
  }

  // Cursor starts on the ATTENTION row: the hint is live.
  expect((await clearHintAttrs()) & TextAttributes.DIM).toBe(0)
  // `j` moves onto the RECENT row: a recent task has nothing to drop, so
  // the hint must read as unavailable instead of advertising a dead chord.
  mockInput.pressKey("j")
  await settle()
  expect((await clearHintAttrs()) & TextAttributes.DIM).not.toBe(0)
})
