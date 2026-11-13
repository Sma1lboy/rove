import { expect, test } from "bun:test"

test("picking a task leaves the Update and Worktrees pages, as it leaves the rail's pages", async () => {
  Object.assign(globalThis, { sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } })
  const { leaveOnSelect } = await import("../src/layout.ts")
  const { createStore } = await import("../src/store.ts")
  const { page } = await import("../src/ui.ts")
  const selection = createStore({ taskId: "a" })
  const off = leaveOnSelect(selection)

  for (const open of ["update", "worktrees", "routines"] as const) {
    page.set(open)
    selection.set({ taskId: "b" })
    expect(page.get()).toBeNull()
  }
  off()
})
