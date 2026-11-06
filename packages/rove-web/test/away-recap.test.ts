import { describe, expect, test } from "bun:test"
import type { TaskRow } from "rove-bridge/protocol"
import { AWAY_MS, recapOf } from "../src/away-recap.ts"

const NOW = 10_000_000
const SEEN = { at: NOW - 3 * AWAY_MS, merged: ["old-pr"] }
const task = (id: string, extra: Partial<TaskRow> = {}): TaskRow =>
  ({ id, title: id, label: id, repo: "/r", kind: "task", deleting: false, group: "idle", ...extra }) as TaskRow
const episode = (state: string, since: number) => ({ state, forMs: 0, since })

describe("away recap", () => {
  test("counts what began after the last look, what waits now, and PRs merged since", () => {
    const rows = [
      task("done-late", { activity: episode("turn_complete", SEEN.at + 1000) }),
      task("done-early", { activity: episode("turn_complete", SEEN.at - 1000) }),
      task("failed", { activity: episode("error", SEEN.at + 5), group: "waiting-on-you" }),
      task("asks", { activity: episode("permission_needed", SEEN.at - 9000), group: "waiting-on-you" }),
      task("merged", { pr: { lifecycle: "merged", checkState: "passing" } }),
      task("old-pr", { pr: { lifecycle: "merged", checkState: "passing" } }),
    ]
    const found = recapOf(rows, SEEN, NOW)
    expect(found?.finished.map((r) => r.id)).toEqual(["done-late"])
    expect(found?.failed.map((r) => r.id)).toEqual(["failed"])
    // A failure waits on you too, but is counted once, under failed.
    expect(found?.needs.map((r) => r.id)).toEqual(["asks"])
    expect(found?.merged.map((r) => r.id)).toEqual(["merged"])
    expect(found?.since).toBe(SEEN.at)
  })

  test("nothing before the threshold, without an earlier look, or when nothing changed", () => {
    const rows = [task("done", { activity: episode("turn_complete", NOW - 1) })]
    expect(recapOf(rows, { at: NOW - AWAY_MS, merged: [] }, NOW)).toBeNull()
    expect(recapOf(rows, null, NOW)).toBeNull()
    expect(recapOf([task("quiet")], SEEN, NOW)).toBeNull()
  })

  test("a task being deleted is not counted", () => {
    const rows = [task("gone", { deleting: true, activity: episode("turn_complete", NOW - 1) })]
    expect(recapOf(rows, SEEN, NOW)).toBeNull()
  })
})
