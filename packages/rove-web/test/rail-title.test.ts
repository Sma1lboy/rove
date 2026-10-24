import { describe, expect, test } from "bun:test"
import type { TabRow, TaskRow } from "rove-bridge/protocol"
import { rowTitle } from "../src/rail.ts"

const task = (extra: Partial<TaskRow> = {}): TaskRow =>
  ({ id: "t", title: "(new task)", repo: "/r/app", kind: "task", branch: "b", rank: 1, ...extra }) as TaskRow
const tab = (extra: Partial<TabRow>): TabRow =>
  ({ id: "tab-1", kind: "engine", title: null, conversation: null, alive: true, engineAlive: true, ...extra }) as TabRow

describe("task row title", () => {
  test("a task is named by its engine's name for the conversation, as in the TUI", () => {
    expect(rowTitle(task(), [tab({ conversation: "Fix the login redirect" })])).toBe("Fix the login redirect")
  })

  test("an engine that has named nothing yet leaves the task's own title", () => {
    expect(rowTitle(task({ title: "Seeded" }), [tab({ conversation: null })])).toBe("Seeded")
  })

  test("shell tabs and tasks without tabs fall back to the task title; a project's main row never takes a tab's", () => {
    expect(rowTitle(task({ title: "Seeded" }), [tab({ kind: "command", conversation: "vim" })])).toBe("Seeded")
    expect(rowTitle(task({ title: "Seeded" }), undefined)).toBe("Seeded")
    expect(rowTitle(task({ kind: "main", title: "app" }), [tab({ conversation: "Fix it" })])).toBe("app")
  })
})
