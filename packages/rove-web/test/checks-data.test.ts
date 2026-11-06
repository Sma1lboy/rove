import { describe, expect, test } from "bun:test"
import type { TaskRow, TaskRowPr } from "rove-bridge/protocol"
import { duration, hasChecks, mergeParts } from "../src/checks-data.ts"

const pr = (over: Partial<TaskRowPr> = {}): TaskRowPr => ({
  number: 7,
  lifecycle: "open",
  checkState: "passing",
  ...over,
})
const task = (over: Partial<TaskRow> = {}): TaskRow => ({ id: "t", kind: "task", pr: pr(), ...over }) as TaskRow
const view = { mergeable: "MERGEABLE", mergeState: "CLEAN", review: "", draft: false }
const keys = (v: Parameters<typeof mergeParts>[0]) => mergeParts(v).map((p) => p.key)

describe("checks section", () => {
  test("only an open PR on this machine's own row has checks to read", () => {
    expect(hasChecks(task())).toBe(true)
    expect(hasChecks(task({ pr: pr({ lifecycle: "ready_to_merge" }) }))).toBe(true)
    expect(hasChecks(task({ pr: pr({ lifecycle: "merged" }) }))).toBe(false)
    expect(hasChecks(task({ pr: pr({ number: undefined }) }))).toBe(false)
    expect(hasChecks(task({ pr: null }))).toBe(false)
    expect(hasChecks(task({ machine: { id: "m", label: "m" } }))).toBe(false)
  })

  test("durations read compactly across the minute and hour boundaries", () => {
    expect([42_000, 192_000, 3_660_000].map(duration)).toEqual(["42s", "3m12s", "1h01m"])
  })

  test("a conflict is named instead of a clean merge, and the review decision always shows", () => {
    expect(keys(view)).toEqual(["files.merge.clean"])
    expect(keys({ ...view, mergeable: "CONFLICTING", mergeState: "DIRTY", review: "CHANGES_REQUESTED" })).toEqual([
      "files.merge.conflicts",
      "files.merge.changes",
    ])
    expect(keys({ ...view, mergeState: "BLOCKED", review: "REVIEW_REQUIRED" })).toEqual([
      "files.merge.blocked",
      "files.merge.reviewRequired",
    ])
  })

  test("a draft is never called mergeable", () => {
    expect(keys({ ...view, draft: true })).toEqual(["files.merge.draft"])
  })
})
