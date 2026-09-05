/** @jsxImportSource @opentui/react */
/**
 * Scale guard for the cross-task notifier (use-attention): the toast loops
 * must not re-scan the whole `tasks` array per notification. Both effects
 * used `tasks.find(t => t.id === …)` INSIDE their per-edge / per-item loop —
 * with a few hundred tasks and one edge each, every notification paid an
 * O(tasks) scan. The fix hoists one Map build per effect run; this probe
 * counts `Array.prototype.find` calls on the exact array handed to the hook
 * and pins the count at zero while edges and deferred episodes flow.
 */

import { expect, test } from "bun:test"
import { useEffect, useState } from "react"
import type { AttentionInboxItem, TaskEngineState } from "../../src/client/remote-orchestrator"
import type { KVContext } from "../../src/tui-react/context/kv"
import type { NotificationsContext } from "../../src/tui-react/context/notifications"
import { useAttention } from "../../src/tui-react/workspace/use-attention"
import type { NotifyInput } from "../../src/tui/lib/notify-state"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"
import { act, renderComponent } from "./harness"

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
    clear: () => true,
  }
}

function notifSpy(): { notif: NotificationsContext; calls: NotifyInput[] } {
  const calls: NotifyInput[] = []
  const notif = {
    toasts: [],
    unread: new Map(),
    notify: (input: NotifyInput) => {
      calls.push(input)
    },
    dismiss: () => {},
    markRead: () => {},
  }
  return { notif: notif as unknown as NotificationsContext, calls }
}

function task(id: string): Task {
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
  }
}

/** The tasks array with its `find` instrumented — the scale-regression tripwire. */
class CountingTasks extends Array<Task> {
  finds = 0
  override find(predicate: (value: Task, index: number, obj: Task[]) => unknown, thisArg?: unknown): Task | undefined {
    this.finds += 1
    return super.find(predicate, thisArg)
  }
}

let pushEdge: () => void = () => {}
let pushDeferred: (at: number) => void = () => {}

function AttentionScaleProbe(props: { tasks: CountingTasks; notif: NotificationsContext }) {
  const [engineState, setEngineState] = useState<ReadonlyMap<string, TaskEngineState>>(
    () => new Map([["task-1", { state: "idle", at: 1 }]]),
  )
  const [inboxItems, setInboxItems] = useState<AttentionInboxItem[]>([])
  useEffect(() => {
    pushEdge = () => setEngineState(new Map([["task-1", { state: "turn_complete", at: 2 }]]))
    pushDeferred = (at: number) =>
      setInboxItems((prev) => [
        ...prev,
        {
          taskId: "task-2",
          tabId: "tab-1",
          state: "prompt_deferred",
          unread: true,
          at,
          detail: { deferredPrompt: { id: "d1", layer: "composer-not-empty" } },
        },
      ])
  }, [])
  useAttention({
    tasks: props.tasks,
    engineState,
    inboxItems,
    selectedId: null,
    kv: stubKv(),
    notif: props.notif,
    openAttention: () => {},
    noTasksMessage: "none",
  })
  return null
}

test("edge and deferred-episode toasts perform zero per-item tasks.find scans", async () => {
  const { notif, calls } = notifSpy()
  const tasks = new CountingTasks(task("task-1"), task("task-2"), task("task-3"))
  await renderComponent(<AttentionScaleProbe tasks={tasks} notif={notif} />, { width: 80, height: 24 })
  expect(calls).toHaveLength(0) // seed render fires nothing

  await act(async () => {
    pushEdge() // rising edge: idle → turn_complete on task-1
    pushDeferred(1000) // fresh prompt_deferred episode on task-2
  })
  await act(async () => {})
  // Both notifiers fired (proves the loops actually ran)…
  expect(calls.some((c) => c.kind === "done" && c.taskId === "task-1")).toBe(true)
  expect(calls.some((c) => c.kind === "needs_input" && c.taskId === "task-2")).toBe(true)
  // …without a single linear tasks scan. Reverting the Map hoist makes this
  // count 2 (one find per loop body).
  expect(tasks.finds).toBe(0)
})
