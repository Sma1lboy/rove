/**
 * Field-note handler tests (`note.file` / `note.list`, docs/design/
 * dispatcher.md).
 *
 * A note is stored and nothing else: it reaches sessions through the next
 * launch's system prompt, never as a turn on a running one. A store failure
 * must not error the agent that filed the note.
 */

import { describe, expect, it } from "vitest"
import type { Task } from "../../src/types/task.ts"
import { TASK, dispatch, fakeCtx } from "./handler-test-context.ts"

const MAIN: Task = { ...TASK, id: "m1", kind: "main", title: "repo" } as Task

describe("note.file", () => {
  it("stores the note with provenance and starts no turn on the repo's main session", async () => {
    const { ctx, rec } = fakeCtx({
      getTask: (id: string) => (id === "t1" ? TASK : undefined),
      listTasks: () => [MAIN, TASK],
    })
    const result = await dispatch("note.file", { taskId: "t1", text: "build needs --no-sandbox" }, ctx)

    expect(result).toEqual({ ok: true, persisted: true })
    expect(rec.noteCalls).toHaveLength(1)
    expect(rec.noteCalls[0]).toMatchObject({ method: "append", repo: "/repo" })
    expect(rec.noteCalls[0]?.note).toMatchObject({
      text: "build needs --no-sandbox",
      taskId: "t1",
      author: "demo task",
    })
    expect(rec.published.filter((p) => p.channel === "session.deliver")).toHaveLength(0)
  })

  it("answers ok when the store throws — filing must never error a working agent", async () => {
    const { ctx } = fakeCtx({
      getTask: (id: string) => (id === "t1" ? TASK : undefined),
      listTasks: () => [MAIN, TASK],
      noteAppendThrows: true,
    })
    const result = await dispatch("note.file", { taskId: "t1", text: "lost" }, ctx)

    expect(result).toEqual({ ok: true, persisted: false })
  })

  it("rejects an unknown author task and files nothing", async () => {
    const { ctx, rec } = fakeCtx({ getTask: () => undefined, listTasks: () => [] })
    await expect(dispatch("note.file", { taskId: "nope", text: "x" }, ctx)).rejects.toThrow("task not found: nope")
    expect(rec.noteCalls).toHaveLength(0)
  })
})

describe("note.list", () => {
  it("returns the repo's stored notes", async () => {
    const notes = [{ at: "2026-08-08T00:00:00.000Z", text: "a gotcha", taskId: "t1", author: "demo task" }]
    const { ctx, rec } = fakeCtx({ notes })
    await expect(dispatch("note.list", { repo: "/repo" }, ctx)).resolves.toEqual({ notes })
    expect(rec.noteCalls).toEqual([{ method: "list", repo: "/repo" }])
  })
})
