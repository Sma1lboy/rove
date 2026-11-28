import { describe, expect, test } from "bun:test"
import type { TaskRow } from "rove-bridge/protocol"
import { extPages, sessionLine2 } from "../src/phone-rows.ts"
import { routineLook, routineNeedsYou } from "../src/routines-data.ts"

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

describe("a phone routine row's status dots", () => {
  test.each<[string, Parameters<typeof routineLook>[0], boolean, ReturnType<typeof routineLook>]>([
    ["a run that worked", "ran", true, "done"],
    ["a failed command", "script_failed", true, "error"],
    ["a failure on a paused routine", "dispatch_failed", false, "error"],
    ["an engine that is not there", "skipped_unavailable", true, "waiting"],
    ["a tick that was refused", "skipped_blocked", true, "idle"],
    ["a paused routine whose last run worked", "ran", false, "idle"],
    ["a routine that never ran", undefined, true, "idle"],
  ])("draw %s", (_, status, enabled, look) => {
    expect(routineLook(status, enabled)).toBe(look)
  })
})
