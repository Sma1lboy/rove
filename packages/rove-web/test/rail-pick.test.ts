import { beforeEach, describe, expect, test } from "bun:test"
import type { MouseEvent } from "react"
import { pickClick, railPick } from "../src/rail-pick.tsx"
import type { NavRow } from "../src/rail.ts"

const head = (id: string) => ({ kind: "project", id }) as NavRow
const task = (id: string) => ({ kind: "task", id, task: { id } }) as NavRow
const rows = [head("p1"), task("a"), task("b"), head("p2"), task("c"), task("d")]
const click = (mods: Partial<MouseEvent> = {}) =>
  ({ shiftKey: false, metaKey: false, ctrlKey: false, ...mods }) as MouseEvent
const picked = () => [...railPick.get().ids].sort()

beforeEach(() => railPick.set({ ids: new Set(), anchor: null }))

describe("rail multi-pick", () => {
  test("Shift+click picks the task rows from the last plain click to here, across project headers", () => {
    expect(pickClick(click(), "b", rows, null)).toBe(false)
    expect(pickClick(click({ shiftKey: true }), "d", rows, null)).toBe(true)
    expect(picked()).toEqual(["b", "c", "d"])
    // A second Shift+click re-ranges from the same anchor.
    pickClick(click({ shiftKey: true }), "a", rows, null)
    expect(picked()).toEqual(["a", "b"])
  })

  test("Cmd/Ctrl+click adds the open task first, then toggles rows; a plain click clears", () => {
    pickClick(click({ metaKey: true }), "c", rows, "a")
    expect(picked()).toEqual(["a", "c"])
    pickClick(click({ ctrlKey: true }), "a", rows, "a")
    expect(picked()).toEqual(["c"])
    pickClick(click(), "d", rows, "a")
    expect(picked()).toEqual([])
  })
})
