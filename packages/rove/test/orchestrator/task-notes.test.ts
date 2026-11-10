import { applyTodoOps, coerceTodos, parseTodoOps, todoCount } from "@sma1lboy/rove-daemon/task-notes"
import { describe, expect, it } from "vitest"

const list = [
  { id: "t1", text: "a", done: true },
  { id: "t3", text: "b", done: false },
]

describe("applyTodoOps", () => {
  it("adds after the highest id so a removed item's id is not handed out again", () => {
    const out = applyTodoOps(list, [{ op: "add", text: "  new   item " }])
    expect(out.at(-1)).toEqual({ id: "t4", text: "new item", done: false })
  })

  it("applies check, edit and remove in order, leaving the input untouched", () => {
    const out = applyTodoOps(list, [
      { op: "check", id: "t3", done: true },
      { op: "edit", id: "t1", text: "renamed" },
      { op: "remove", id: "t3" },
    ])
    expect(out).toEqual([{ id: "t1", text: "renamed", done: true }])
    expect(list).toHaveLength(2)
  })

  it("refuses an unknown id, empty text and a full list, so the caller keeps what it had", () => {
    expect(() => applyTodoOps(list, [{ op: "check", id: "t9", done: true }])).toThrow(/no todo t9/)
    expect(() => applyTodoOps(list, [{ op: "add", text: "   " }])).toThrow(/needs some text/)
    const full = Array.from({ length: 100 }, (_, i) => ({ id: `t${i + 1}`, text: "x", done: false }))
    expect(() => applyTodoOps(full, [{ op: "add", text: "one more" }])).toThrow(/at most 100/)
    expect(() => applyTodoOps(list, [{ op: "add", text: "x".repeat(501) }])).toThrow(/at most 500/)
  })
})

describe("stored and wire forms", () => {
  it("a stored list drops malformed items and an empty result is no list", () => {
    expect(
      coerceTodos([{ id: "t1", text: "ok", done: 1 }, { id: "x", text: "bad id" }, null, { id: "t2", text: " " }]),
    ).toEqual([{ id: "t1", text: "ok", done: false }])
    expect(coerceTodos([])).toBeUndefined()
    expect(coerceTodos("nope")).toBeUndefined()
  })

  it("counts done over all, and nothing for no todos", () => {
    expect(todoCount(list)).toEqual({ done: 1, total: 2 })
    expect(todoCount(undefined)).toBeNull()
    expect(todoCount([])).toBeNull()
  })

  it("parses wire ops and refuses a shape it does not know", () => {
    expect(
      parseTodoOps([
        { op: "add", text: "x" },
        { op: "check", id: "t1", done: false },
      ]),
    ).toEqual([
      { op: "add", text: "x" },
      { op: "check", id: "t1", done: false },
    ])
    expect(() => parseTodoOps([{ op: "check", id: "t1" }])).toThrow()
    expect(() => parseTodoOps("add")).toThrow()
  })
})
