import { describe, expect, test } from "bun:test"
import type { TaskRow } from "rove-bridge/protocol"
import type { AppModel } from "../src/model.ts"

// row-actions pulls in the i18n and prefs modules, which read browser globals at load.
const g = globalThis as Record<string, unknown>
// Bun has its own `navigator` without `language`, so replace it rather than default it.
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { language: "en-US", languages: ["en-US"], platform: "Linux", userAgent: "bun" },
})
g.window ??= globalThis
const memory = new Map<string, string>()
g.localStorage ??= {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
}
const { taskMenu } = await import("../src/row-actions.tsx")

const task = (extra: Partial<TaskRow> = {}): TaskRow =>
  ({
    id: "t1",
    title: "t1",
    repo: "/w/app",
    kind: "task",
    branch: "fix/x",
    rank: 1,
    status: "in_progress",
    ...extra,
  }) as TaskRow
const model = { client: { request: async () => ({}) } } as unknown as AppModel
const labels = (row: TaskRow) => taskMenu(model, row, null).map((item) => item.label)

describe("a task on another machine keeps its menu", () => {
  test("it drops only what this machine alone can do: editor, rail order, engine pick", () => {
    const here = labels(task())
    const there = labels(task({ machine: { id: "mac", label: "mac" } }))
    const dropped = here.filter((label) => !there.includes(label))
    expect(dropped).toHaveLength(3)
    // Everything else — new chat/shell, rename, pin, status, branch, land, copy, delete — stays.
    expect(there.length).toBe(here.length - 3)
    expect(there).toEqual(here.filter((label) => !dropped.includes(label)))
  })
})
