import { prChip, sidebarPrChip } from "@/sidebar/row-chips"
import type { Task } from "@/types/task"
import { describe, expect, test } from "vitest"

const status = (checkState: string, lifecycle = "open") => ({ lifecycle, checkState }) as never

const session = (url: string, prStatus?: never) =>
  ({ url, addedAt: "2026-10-27T00:00:00.000Z", ...(prStatus ? { status: prStatus } : {}) }) as never

describe("sidebarPrChip", () => {
  test("a task with no PR of its own shows the chip of a PR its session attached", () => {
    const main = {
      kind: "dir",
      sessionPrs: [session("https://github.com/o/r/pull/1", status("failing"))],
    } as unknown as Task
    expect(prChip(main)).toBeNull()
    expect(sidebarPrChip(main)?.kind).toBe("failing")
  })

  test("a failing attached PR beats the task's own passing one", () => {
    const task = {
      prStatus: status("passing"),
      sessionPrs: [session("https://github.com/o/r/pull/2", status("failing"))],
    } as unknown as Task
    expect(sidebarPrChip(task)?.kind).toBe("failing")
  })

  test("an attached PR not polled yet draws nothing", () => {
    const main = { kind: "dir", sessionPrs: [session("https://github.com/o/r/pull/3")] } as unknown as Task
    expect(sidebarPrChip(main)).toBeNull()
  })
})
