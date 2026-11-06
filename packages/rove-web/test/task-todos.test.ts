import { describe, expect, test } from "bun:test"
import { openTodos, todoCount, todoPrompt } from "../src/task-todos.ts"

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

  test("the prompt lists only what is unchecked, and there is none when all is done", () => {
    expect(openTodos({ todos }).map((t) => t.id)).toEqual(["t2", "t3"])
    const prompt = todoPrompt({ todos })
    expect(prompt).toContain("- update the docs\n- ask about rollback")
    expect(prompt).not.toContain("migration")
    expect(todoPrompt({ todos: todos.map((t) => ({ ...t, done: true })) })).toBeNull()
    expect(todoPrompt({})).toBeNull()
  })
})
