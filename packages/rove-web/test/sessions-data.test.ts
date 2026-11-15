import { expect, test } from "bun:test"
import type { TaskRow, TasksPayload } from "rove-bridge/protocol"
import { sessionRepos, sessionRows } from "../src/sessions-data.ts"

const row = (id: string, over: Partial<TaskRow> = {}): TaskRow =>
  ({ id, label: id, repo: "/r/app", kind: "task", updatedAt: "2026-11-01T00:00:00Z", ...over }) as TaskRow

const payload = {
  tasks: [
    row("old"),
    row("new", { updatedAt: "2026-11-05T00:00:00Z" }),
    row("idle-main", { kind: "main" }),
    row("elsewhere", { repo: "/r/site" }),
    row("nightly-run", { routine: true, updatedAt: "2026-11-09T00:00:00Z" }),
  ],
  archived: [row("gone", { archived: true }), row("gone-main", { repo: "/r/docs", kind: "main", archived: true })],
} as unknown as TasksPayload

test("a project's Active list is its live sessions, newest first, without a main that has no tab open", () => {
  const ids = sessionRows(payload, { "idle-main": [] }, "/r/app", "active").map((task) => task.id)
  expect(ids).toEqual(["new", "old"])
})

test("Archived lists what the rail no longer shows, an archived main session included", () => {
  expect(sessionRows(payload, {}, "/r/app", "archived").map((task) => task.id)).toEqual(["gone"])
  expect(sessionRows(payload, {}, null, "archived").map((task) => task.id)).toEqual(["gone", "gone-main"])
})

test("a project with only archived sessions is still one the page can switch to", () => {
  expect(sessionRepos(payload)).toEqual(["/r/app", "/r/site", "/r/docs"])
})
