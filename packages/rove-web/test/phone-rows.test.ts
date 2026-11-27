import { describe, expect, test } from "bun:test"
import type { TaskRow } from "rove-bridge/protocol"
import { extPages, sessionAge, sessionLine2 } from "../src/phone-rows.ts"
import { routineNeedsYou } from "../src/routines-data.ts"

const names = { kanban: "Kanban", issues: "Issues" }
const pane = { plugin: "examples.counter-mod", id: "counter", title: "Counter", tree: { type: "text", text: "" } }

describe("a phone session row's second line", () => {
  test("names the branch and how far it is behind its base", () => {
    const task = { branch: "web/phone-rows", changes: { added: 3, deleted: 1, ahead: 2, behind: 126 } }
    expect(sessionLine2(task)).toEqual({ branch: "web/phone-rows", behind: "↓126" })
  })

  test.each<[string, TaskRow["changes"]]>([
    ["nothing was collected", undefined],
    ["git could not be read", { unreadable: true }],
    ["the branch is up to date", { added: 0, deleted: 0, behind: 0 }],
  ])("shows no count when %s", (_, changes) => {
    expect(sessionLine2({ branch: "main", changes }).behind).toBeNull()
  })
})

describe("a phone session row's age", () => {
  test("counts from the episode's start, and is a dash with no reading", () => {
    expect(sessionAge({ activity: { state: "idle", forMs: 5_000, since: 1_000 } }, 961_000)).toBe("16m")
    expect(sessionAge({ activity: { state: "idle", forMs: 120_000 } }, 0)).toBe("2m")
    expect(sessionAge({ activity: null }, 0)).toBe("—")
  })
})

describe("the phone's Extensions list", () => {
  test("is empty with no extension installed: the sheet is then only Add extension", () => {
    expect(extPages(new Set(), [], names)).toEqual([])
  })

  test("lists the installed first-party pages, then one entry per open mod pane", () => {
    const pages = extPages(new Set(["issues", "kanban"]), [pane as never], names)
    expect(pages.map((entry) => [entry.id, entry.page, entry.title])).toEqual([
      ["kanban", "kanban", "Kanban"],
      ["issues", "issues", "Issues"],
      ["mod:examples.counter-mod/counter", "mods", "Counter"],
    ])
  })
})

describe("the phone's Routines button count", () => {
  test("counts a routine whose last run failed, not one that finished or never ran", () => {
    const reply = { lastRunStatus: { broke: "dispatch_failed", fine: "dispatched" } } as const
    expect(["broke", "fine", "new"].filter((id) => routineNeedsYou(reply, id))).toEqual(["broke"])
    expect(routineNeedsYou(null, "broke")).toBe(false)
  })
})
