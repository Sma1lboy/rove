import { describe, expect, test } from "bun:test"
import { type TimelineDeps, mergeTimeline, timelineOps } from "../src/ops/timeline.ts"
import { T, fakeApi } from "./task-ops-harness.ts"

const commit = (sha: string, at: number, subject: string) => ({ sha, at, subject })

describe("mergeTimeline", () => {
  test("interleaves events and commits newest first and drops tool calls", () => {
    const rows = mergeTimeline(
      [
        { kind: "turn-start", at: 10, tabId: "tab-1", vendor: "claude" },
        { kind: "tool-pre", at: 11, detail: { tool: { name: "Bash" } } },
        { kind: "tool-post", at: 12 },
        { kind: "tool-failed", at: 13, detail: { tool: { name: "Bash" } } },
        { kind: "turn-complete", at: 30, tabId: "tab-1" },
      ],
      [commit("abc", 20, "fix it")],
      50,
    )
    expect(rows.map((r) => r.kind)).toEqual(["turn-complete", "commit", "tool-failed", "turn-start"])
    expect(rows[1]).toEqual({ kind: "commit", at: 20, tail: "fix it", sha: "abc" })
    expect(rows[2]?.tail).toBe("Bash")
    expect(rows[3]).toMatchObject({ tabId: "tab-1", tail: "claude" })
  })

  test("keeps the newest rows when over the limit", () => {
    const events = [1, 2, 3, 4].map((at) => ({ kind: "turn-start", at }))
    expect(mergeTimeline(events, [], 2).map((r) => r.at)).toEqual([4, 3])
  })
})

describe("task.timeline", () => {
  const deps = (over: Partial<TimelineDeps> = {}): TimelineDeps => ({
    base: async () => "origin/main",
    commits: async () => [commit("abc", 20, "fix it")],
    ...over,
  })
  const run = (replies: Record<string, unknown>, d = deps()) => {
    const { api } = fakeApi(replies)
    const spec = timelineOps(d)["task.timeline"]
    if (!spec) throw new Error("no op")
    return spec.run({ taskId: T }, { api })
  }
  const task = { task: { worktreePath: "/wt", prStatus: { baseRef: "main" } } }

  test("reads events and commits of the task's worktree", async () => {
    const res = await run({ "task.recentEvents": { events: [{ kind: "session-end", at: 30 }] }, "get-task": task })
    expect(res).toEqual({
      entries: [
        { kind: "session-end", at: 30, tail: "" },
        { kind: "commit", at: 20, tail: "fix it", sha: "abc" },
      ],
    })
  })

  test("no base ref means no commits are guessed", async () => {
    const res = await run({ "task.recentEvents": { events: [] }, "get-task": task }, deps({ base: async () => null }))
    expect(res).toEqual({ entries: [] })
  })

  test("a task with no worktree still lists its events", async () => {
    const res = (await run({
      "task.recentEvents": { events: [{ kind: "turn-start", at: 1 }] },
      "get-task": { task: {} },
    })) as { entries: unknown[] }
    expect(res.entries).toHaveLength(1)
  })
})
