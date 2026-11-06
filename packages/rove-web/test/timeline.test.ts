import { describe, expect, test } from "bun:test"
import type { TaskRowPr } from "rove-bridge/protocol"
import { jumpOf, mergeRows, prChanges } from "../src/timeline.ts"

const pr = (over: Partial<TaskRowPr> = {}): TaskRowPr => ({ lifecycle: "open", checkState: "pending", ...over })

describe("prChanges", () => {
  test("a PR appearing is opened; the same PR again says nothing", () => {
    expect(prChanges(null, pr())).toEqual(["pr-opened"])
    expect(prChanges(pr(), pr())).toEqual([])
    expect(prChanges(pr(), null)).toEqual([])
  })

  test("checks flip to failing or passing, once", () => {
    expect(prChanges(pr(), pr({ checkState: "failing" }))).toEqual(["pr-failing"])
    expect(prChanges(pr({ checkState: "failing" }), pr({ checkState: "passing" }))).toEqual(["pr-passing"])
    expect(prChanges(pr({ checkState: "failing" }), pr({ checkState: "pending" }))).toEqual([])
  })

  test("the first poll of a PR is not a change in its checks", () => {
    expect(prChanges(pr({ lifecycle: "unknown", checkState: "unknown" }), pr({ checkState: "failing" }))).toEqual([])
  })

  test("merge, close, conflict and changes-requested each show when they begin", () => {
    expect(prChanges(pr(), pr({ lifecycle: "merged" }))).toEqual(["pr-merged"])
    expect(prChanges(pr(), pr({ lifecycle: "closed" }))).toEqual(["pr-closed"])
    expect(prChanges(pr(), pr({ mergeable: "CONFLICTING" }))).toEqual(["pr-conflict"])
    expect(prChanges(pr({ mergeable: "CONFLICTING" }), pr({ mergeable: "CONFLICTING" }))).toEqual([])
    expect(prChanges(pr(), pr({ reviewDecision: "CHANGES_REQUESTED" }))).toEqual(["pr-changes"])
  })
})

describe("jumpOf", () => {
  test("a commit opens the diff, a PR row its address, an engine event its tab", () => {
    expect(jumpOf({ kind: "commit", at: 1, tail: "x", sha: "a" })).toEqual({ to: "diff" })
    expect(jumpOf({ kind: "pr-merged", at: 1, tail: "", url: "https://x/pull/1" })).toEqual({
      to: "pr",
      url: "https://x/pull/1",
    })
    expect(jumpOf({ kind: "turn-complete", at: 1, tail: "", tabId: "tab-2" })).toEqual({ to: "tab", tabId: "tab-2" })
  })

  test("a row with nowhere to go goes nowhere", () => {
    expect(jumpOf({ kind: "turn-start", at: 1, tail: "" })).toBeNull()
    expect(jumpOf({ kind: "pr-opened", at: 1, tail: "" })).toBeNull()
  })
})

describe("mergeRows", () => {
  test("orders both sources newest first", () => {
    const rows = mergeRows(
      [{ kind: "turn-start", at: 5, tail: "" }],
      [
        { kind: "pr-opened", at: 9, tail: "" },
        { kind: "pr-failing", at: 2, tail: "" },
      ],
    )
    expect(rows.map((r) => r.at)).toEqual([9, 5, 2])
  })
})
