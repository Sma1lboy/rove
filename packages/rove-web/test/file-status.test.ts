import { describe, expect, test } from "bun:test"
import type { DiffFileRow } from "rove-bridge/protocol"
import { hasWorkingDiff, treeStates } from "../src/file-status.ts"

const row = (path: string, status: string, scope: "branch" | "working" = "working"): DiffFileRow => ({
  path,
  status,
  added: 1,
  deleted: 0,
  scope,
})

describe("treeStates", () => {
  test("a directory takes the strongest state beneath it, at every level", () => {
    const states = treeStates([row("src/a/new.ts", "A"), row("src/a/b/deep.ts", "D"), row("src/c.ts", "M")])
    expect(states.get("src/a/new.ts")).toBe("added")
    expect(states.get("src/a/b/")).toBe("deleted")
    expect(states.get("src/a/")).toBe("deleted")
    expect(states.get("src/")).toBe("deleted")
  })

  test("modified outranks added and untracked outranks renamed", () => {
    const states = treeStates([row("x/m.ts", "M"), row("x/n.ts", "?"), row("y/r.ts", "R"), row("y/u.ts", "?")])
    expect(states.get("x/")).toBe("modified")
    expect(states.get("y/")).toBe("untracked")
  })

  test("an uncommitted state wins over a committed one for the same file", () => {
    const states = treeStates([row("a.ts", "A", "branch"), row("a.ts", "M", "working")])
    expect(states.get("a.ts")).toBe("modified")
    expect(treeStates([row("a.ts", "M", "working"), row("a.ts", "A", "branch")]).get("a.ts")).toBe("modified")
  })

  test("a committed-only change still colours the file", () => {
    expect(treeStates([row("a.ts", "M", "branch")]).get("a.ts")).toBe("modified")
  })

  test("a status the tree has no colour for leaves the file plain", () => {
    expect(treeStates([row("a.ts", "X")]).size).toBe(0)
  })
})

describe("hasWorkingDiff", () => {
  test("only an uncommitted, tracked change has a diff to toggle to", () => {
    const rows = [row("a.ts", "M"), row("b.ts", "?"), row("c.ts", "M", "branch")]
    expect(hasWorkingDiff(rows, "a.ts")).toBe(true)
    expect(hasWorkingDiff(rows, "b.ts")).toBe(false)
    expect(hasWorkingDiff(rows, "c.ts")).toBe(false)
    expect(hasWorkingDiff(rows, "d.ts")).toBe(false)
  })
})
