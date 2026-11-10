import { describe, expect, test } from "bun:test"
import { openTodos, todoCount } from "../src/task-todos.ts"

const todos = [
  { id: "t1", text: "check the migration", done: true },
  { id: "t2", text: "update the docs", done: false },
  { id: "t3", text: "ask about rollback", done: false },
]

describe("task todos", () => {
  test("count is done over all, and absent without todos so the row stays quiet", () => {
    expect(todoCount({ todos })).toEqual({ done: 1, total: 3 })
    expect(todoCount({})).toBeNull()
    expect(todoCount({ todos: [] })).toBeNull()
  })

  test("open todos are only the unchecked ones", () => {
    expect(openTodos({ todos }).map((t) => t.id)).toEqual(["t2", "t3"])
  })
})
