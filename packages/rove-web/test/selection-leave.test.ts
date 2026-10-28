import { expect, test } from "bun:test"
import type { TaskRow } from "rove-bridge/protocol"
import { selectionAfterLeave } from "../src/model.ts"

const row = (id: string, over: Partial<TaskRow> = {}) => ({ id, ...over }) as TaskRow
const visit = (taskId: string, tabId: string | null = null) => ({ taskId, tabId, at: 0 })
const open = { taskId: "a", tabId: "tab-1" }

test("archiving or deleting the open task goes back to the last visited live one, else to no task", () => {
  const before = [row("a"), row("b"), row("c")]
  const visits = [visit("a", "tab-1"), visit("gone"), visit("c", "tab-2"), visit("b")]
  // Archived: it left the live list (it now sits in the Archived fold).
  expect(selectionAfterLeave(before, [row("b"), row("c")], open, visits)).toEqual({ taskId: "c", tabId: "tab-2" })
  // Delete in flight: still listed, but greyed out.
  expect(selectionAfterLeave(before, [row("a", { deleting: true }), row("b"), row("c")], open, visits)).toEqual({
    taskId: "c",
    tabId: "tab-2",
  })
  expect(selectionAfterLeave(before, [row("b")], open, [visit("a")])).toEqual({ taskId: null, tabId: null })
})

test("an archived task opened from the fold stays open; so does a live one", () => {
  // Never live in this list: the user opened it from the Archived fold.
  expect(selectionAfterLeave([row("b")], [row("b")], open, [visit("b")])).toBeNull()
  expect(selectionAfterLeave([row("a")], [row("a")], open, [visit("b")])).toBeNull()
})
