import { DEFAULT_GLYPHS } from "@/tui/lib/glyphs"
import { prChip, sidebarPrChip } from "@/tui/panes/sidebar/row-chips"
import type { Task } from "@/types/task"
import { describe, expect, test } from "vitest"

const status = (checkState: string, lifecycle = "open") => ({ lifecycle, checkState }) as never

const session = (url: string, prStatus?: never) =>
  ({ url, addedAt: "2026-10-27T00:00:00.000Z", ...(prStatus ? { status: prStatus } : {}) }) as never

describe("sidebarPrChip", () => {
  test("a main task with no PR of its own shows the chip of a PR its session attached", () => {
    const main = {
      kind: "main",
      sessionPrs: [session("https://github.com/o/r/pull/1", status("failing"))],
    } as unknown as Task
    expect(prChip(main)).toBeNull()
    expect(sidebarPrChip(main)?.glyph).toBe(DEFAULT_GLYPHS.checksFailing)
  })

  test("a failing attached PR beats the task's own passing one", () => {
    const task = {
      prStatus: status("passing"),
      sessionPrs: [session("https://github.com/o/r/pull/2", status("failing"))],
    } as unknown as Task
    expect(sidebarPrChip(task)?.glyph).toBe(DEFAULT_GLYPHS.checksFailing)
  })

  test("an attached PR not polled yet draws nothing", () => {
    const main = { kind: "main", sessionPrs: [session("https://github.com/o/r/pull/3")] } as unknown as Task
    expect(sidebarPrChip(main)).toBeNull()
  })
})
