import { PluginEventReducer } from "@sma1lboy/kobe-daemon/plugins/events"
import { describe, expect, it } from "vitest"

function task(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `t-${id}`,
    repo: "/repo",
    branch: `kobe/${id}`,
    worktreePath: `/wt/${id}`,
    kind: "task",
    status: "active",
    archived: false,
    pinned: false,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...extra,
  }
}

function snapshot(reducer: PluginEventReducer, ids: string[]) {
  return reducer.reduce({
    channel: "task.snapshot",
    payload: { tasks: ids.map((id) => task(id)) },
  } as never)
}

describe("PluginEventReducer", () => {
  it("treats the first task snapshot as baseline, then diffs", () => {
    const reducer = new PluginEventReducer(() => 42)
    expect(snapshot(reducer, ["a", "b"])).toEqual([])
    const created = snapshot(reducer, ["a", "b", "c"])
    // The helper's tasks are born WITH a worktree path, so adopt semantics
    // fire worktree.created in the same snapshot as task.created.
    expect(created.map((e) => [e.event, e.taskId])).toEqual([
      ["task.created", "c"],
      ["worktree.created", "c"],
    ])
    const deleted = snapshot(reducer, ["a"])
    expect(deleted.map((e) => [e.event, e.taskId])).toEqual([
      ["task.deleted", "b"],
      ["task.deleted", "c"],
    ])
  })

  it("emits worktree.created when a task's worktree path goes empty → set", () => {
    const reducer = new PluginEventReducer(() => 1)
    const feed = (tasks: Record<string, unknown>[]) =>
      reducer.reduce({ channel: "task.snapshot", payload: { tasks } } as never)
    feed([task("a", { worktreePath: "" })])
    const events = feed([task("a", { worktreePath: "/wt/a" })])
    expect(events.map((e) => e.event)).toEqual(["task.changed", "worktree.created"])
    // task.jobs no longer feeds the reducer at all.
    expect(
      reducer.reduce({
        channel: "task.jobs",
        payload: { taskId: "a", kind: "ensureWorktree", phase: "done" },
      } as never),
    ).toEqual([])
  })

  it("emits task.changed with fields/from/to, task.archived on the flip, and task.pr-changed", () => {
    const reducer = new PluginEventReducer(() => 9)
    const feed = (tasks: Record<string, unknown>[]) =>
      reducer.reduce({ channel: "task.snapshot", payload: { tasks } } as never)
    feed([task("a")])
    const changed = feed([task("a", { title: "renamed", archived: true })])
    expect(changed.map((e) => e.event)).toEqual(["task.changed", "task.archived"])
    expect(changed[0]?.detail).toEqual({
      fields: ["title", "archived"],
      from: { title: "t-a", archived: false },
      to: { title: "renamed", archived: true },
    })
    // Unarchive is a restore: task.changed only, no task.archived.
    const restored = feed([task("a", { title: "renamed" })])
    expect(restored.map((e) => e.event)).toEqual(["task.changed"])
    // PR status has its own event and is not a `fields` entry.
    const pr = feed([task("a", { title: "renamed", prStatus: { state: "open" } })])
    expect(pr.map((e) => e.event)).toEqual(["task.pr-changed"])
    expect(pr[0]?.detail).toEqual({ to: { state: "open" } })
    // Identical snapshot → silence.
    expect(feed([task("a", { title: "renamed", prStatus: { state: "open" } })])).toEqual([])
  })

  it("emits agent.* only on state transitions, keyed per task+tab", () => {
    const reducer = new PluginEventReducer(() => 7)
    const feed = (taskId: string, state: string, tabId?: string) =>
      reducer.reduce({ channel: "engine-state", payload: { taskId, tabId, state, at: 0 } } as never)

    expect(feed("a", "running")).toEqual([expect.objectContaining({ event: "agent.running", taskId: "a" })])
    // Same state again → deduped.
    expect(feed("a", "running")).toEqual([])
    expect(feed("a", "turn_complete")).toEqual([expect.objectContaining({ event: "agent.turn-complete" })])
    // A different tab of the same task tracks its own state.
    expect(feed("a", "running", "tab2")).toEqual([
      expect.objectContaining({ event: "agent.running", taskId: "a", tabId: "tab2" }),
    ])
    expect(feed("a", "permission_needed", "tab2")).toEqual([
      expect.objectContaining({ event: "agent.permission-needed", taskId: "a", tabId: "tab2" }),
    ])
    expect(feed("b", "rate_limited")).toEqual([expect.objectContaining({ event: "agent.rate-limited", taskId: "b" })])
  })

  it("ignores unrelated channels", () => {
    const reducer = new PluginEventReducer()
    expect(reducer.reduce({ channel: "ui-prefs", payload: {} } as never)).toEqual([])
  })
})
