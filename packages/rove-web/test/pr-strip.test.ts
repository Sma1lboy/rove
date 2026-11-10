import { describe, expect, test } from "bun:test"
import type { TaskRow, TaskRowPr } from "rove-bridge/protocol"
import { prActions } from "../src/pr-strip.ts"

const pr = (over: Partial<TaskRowPr> = {}): TaskRowPr => ({ lifecycle: "open", checkState: "passing", ...over })
const task = (over: Partial<TaskRow> = {}): TaskRow => ({ id: "t", kind: "task", pr: null, ...over }) as TaskRow

describe("prActions", () => {
  test("a worktree task with no PR offers create; other kinds, remote and archived rows do not", () => {
    expect(prActions(task())).toEqual(["createPR"])
    expect(prActions(task({ kind: "main" }))).toEqual([])
    expect(prActions(task({ kind: "dir" }))).toEqual([])
    expect(prActions(task({ noWorktree: true }))).toEqual([])
    expect(prActions(task({ archived: true }))).toEqual([])
    expect(prActions(task({ machine: { id: "m", label: "m" } }))).toEqual([])
  })

  test("a PR the session opened elsewhere is not a missing PR", () => {
    expect(prActions(task({ sessionPrs: [pr()] }))).toEqual([])
  })

  test("a healthy open PR offers nothing", () => {
    expect(prActions(task({ pr: pr() }))).toEqual([])
    expect(prActions(task({ pr: pr({ checkState: "pending", reviewDecision: "APPROVED" }) }))).toEqual([])
  })

  test("every problem that applies shows, conflicts then CI then comments", () => {
    const all = pr({ mergeable: "CONFLICTING", checkState: "failing", reviewDecision: "CHANGES_REQUESTED" })
    expect(prActions(task({ pr: all }))).toEqual(["conflicts", "fixCI", "comments"])
    expect(prActions(task({ pr: pr({ checkState: "failing" }) }))).toEqual(["fixCI"])
    expect(prActions(task({ pr: pr(), prChip: "conflict" }))).toEqual(["conflicts"])
  })

  test("merged offers archive, once; closed and unpolled PRs offer nothing", () => {
    expect(prActions(task({ pr: pr({ lifecycle: "merged" }) }))).toEqual(["archive"])
    expect(prActions(task({ pr: pr({ lifecycle: "merged" }), archived: true }))).toEqual([])
    expect(prActions(task({ pr: pr({ lifecycle: "closed", checkState: "failing" }) }))).toEqual([])
    expect(prActions(task({ pr: pr({ lifecycle: "unknown", checkState: "failing" }) }))).toEqual([])
  })

  test("a dirty worktree offers commit first, with or without a PR; an unreadable or clean one does not", () => {
    const dirty = { added: 2, deleted: 0 }
    expect(prActions(task({ changes: dirty }))).toEqual(["commit", "createPR"])
    expect(prActions(task({ changes: dirty, pr: pr({ checkState: "failing" }) }))).toEqual(["commit", "fixCI"])
    expect(prActions(task({ changes: { added: 0, deleted: 0 } }))).toEqual(["createPR"])
    expect(prActions(task({ changes: { unreadable: true } }))).toEqual(["createPR"])
    expect(prActions(task({ changes: dirty, kind: "main" }))).toEqual([])
    expect(prActions(task({ changes: dirty, machine: { id: "m", label: "m" } }))).toEqual([])
  })
})
