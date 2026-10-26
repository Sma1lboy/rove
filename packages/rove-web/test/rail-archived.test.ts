import { describe, expect, test } from "bun:test"
import type { TaskRow } from "rove-bridge/protocol"
import type { AppModel } from "../src/model.ts"
import { ARCHIVED_ROW_ID, groupByProject, navRows, withArchived } from "../src/rail.ts"

// row-actions pulls in the i18n and prefs modules, which read browser globals at load.
const g = globalThis as Record<string, unknown>
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { language: "en-US", languages: ["en-US"], platform: "Linux", userAgent: "bun" },
})
g.window ??= globalThis
// The dialog store hands focus back through `document` when it changes.
g.document ??= { activeElement: null }
g.HTMLElement ??= class {}
const memory = new Map<string, string>()
g.localStorage ??= {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
}
const { taskMenu } = await import("../src/row-actions.tsx")
const { BridgeRequestError } = await import("../src/bridge.ts")
const { dialog, toasts } = await import("../src/ui.ts")

const task = (id: string, extra: Partial<TaskRow> = {}): TaskRow =>
  ({ id, title: id, repo: "/r/app", kind: "task", branch: id, rank: 1, status: "in_progress", ...extra }) as TaskRow

describe("the rail's Archived fold", () => {
  const rows = navRows(groupByProject([task("m", { kind: "main", branch: "" }), task("live")]))
  const archived = [task("p", { archived: true }), task("c", { archived: true, parentTaskId: "p" })]

  test("closed, it is one row after every project", () => {
    expect(withArchived(rows, archived, false).map((row) => row.id)).toEqual([
      "project:/r/app",
      "m",
      "live",
      ARCHIVED_ROW_ID,
    ])
  })

  test("open, its tasks follow it, children under their archived parent, no extra header", () => {
    const open = withArchived(rows, archived, true)
    expect(open.map((row) => row.id)).toEqual(["project:/r/app", "m", "live", ARCHIVED_ROW_ID, "p", "c"])
    expect(open.slice(4).map((row) => (row.kind === "task" ? row.depth : null))).toEqual([1, 2])
  })

  test("nothing archived adds nothing", () => {
    expect(withArchived(rows, [], true)).toBe(rows)
  })
})

describe("Archive in the row menu", () => {
  function harness(reply: (payload: Record<string, unknown>) => unknown) {
    const calls: Array<[string, unknown]> = []
    const model = {
      client: {
        request: async (op: string, payload: Record<string, unknown>) => {
          calls.push([op, payload])
          return reply(payload)
        },
      },
    } as unknown as AppModel
    return { model, calls }
  }
  const entry = (model: AppModel, row: TaskRow) =>
    taskMenu(model, row, null).find((item) => item.label === "Archive" || item.label === "Unarchive")

  test("a task offers Archive, an archived one Unarchive, a project's main neither", () => {
    const { model } = harness(() => ({}))
    expect(entry(model, task("a"))?.label).toBe("Archive")
    expect(entry(model, task("a", { archived: true }))?.label).toBe("Unarchive")
    expect(entry(model, task("m", { kind: "main" }))).toBeUndefined()
  })

  test("Archive sends task.archive, and a TASK_BUSY refusal opens the archive-anyway confirm", async () => {
    dialog.set(null)
    const { model, calls } = harness((payload) => {
      if (!payload.force) throw new BridgeRequestError("TASK_BUSY", "an engine is still working in a")
      return { ids: ["a"] }
    })
    entry(model, task("a"))?.run?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toEqual([["task.archive", { taskId: "a", archived: true }]])
    expect(dialog.get()).not.toBeNull()
  })

  test("Unarchive restores without asking", async () => {
    dialog.set(null)
    toasts.set([])
    const { model, calls } = harness(() => ({ ids: ["a"] }))
    entry(model, task("a", { archived: true }))?.run?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toEqual([["task.archive", { taskId: "a", archived: false }]])
    expect(dialog.get()).toBeNull()
    expect(toasts.get().map((t) => t.text)).toEqual(["Restored a"])
  })
})
