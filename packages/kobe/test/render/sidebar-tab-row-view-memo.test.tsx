/** @jsxImportSource @opentui/react */
/**
 * The tab row's view derivation must be memoized on its real inputs
 * (`useTabRowBaseView` in tree-rows.tsx). The sidebar re-renders on the
 * ~10Hz spinner tick with a fresh `shared` object every render, and without
 * the memo every idle tab row re-ran `buildSidebarRowView` each tick — the
 * flat cards fixed the same thing in `useRowCardChrome` (row-cards.tsx).
 * This probe mounts the hook with CONSTANT inputs, forces re-renders the
 * way the tick does, and pins the returned view to ONE object identity.
 */

import { expect, test } from "bun:test"
import { useState } from "react"
import { useTabRowBaseView } from "../../src/tui-react/panes/sidebar/tree-rows"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"
import { act, renderComponent } from "./harness"

function task(id: string): Task {
  return {
    id: toTaskId(id),
    title: id,
    repo: "/repos/rove",
    branch: `feat/${id}`,
    worktreePath: `/wt/${id}`,
    kind: "task",
    status: "in_progress",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  }
}

const TASK = task("task-1")

let rerender: () => void = () => {}
let renders = 0
let latestView: unknown = null
let firstView: unknown = null

function Probe() {
  const [, setTick] = useState(0)
  rerender = () => setTick((n) => n + 1)
  const view = useTabRowBaseView({
    task: TASK,
    activity: undefined,
    lifecycle: undefined,
    job: undefined,
    completionSeen: false,
  })
  renders += 1
  if (renders === 1) firstView = view
  latestView = view
  return null
}

test("constant inputs keep one view object across spinner-tick re-renders", async () => {
  await renderComponent(<Probe />, { width: 80, height: 24 })
  const before = renders
  // Three ticks — each a fresh render with inputs the tick does NOT change.
  await act(async () => {
    rerender()
  })
  await act(async () => {
    rerender()
  })
  await act(async () => {
    rerender()
  })
  expect(renders).toBeGreaterThan(before)
  // The memo contract: same reference every render. Without the memo each
  // tick re-runs buildSidebarRowView and this is a fresh object.
  expect(latestView).not.toBe(null)
  expect(latestView).toBe(firstView)
})

test("a changed input re-derives the view", async () => {
  renders = 0
  firstView = null
  latestView = null
  let currentActivity: { state: "turn_complete"; at: number } | undefined = undefined
  let pushActivity: () => void = () => {}
  function Probe2() {
    const [activity, setActivity] = useState<typeof currentActivity>(undefined)
    pushActivity = () => setActivity({ state: "turn_complete", at: 2 })
    currentActivity = activity
    const view = useTabRowBaseView({
      task: TASK,
      activity,
      lifecycle: undefined,
      job: undefined,
      completionSeen: false,
    })
    renders += 1
    if (renders === 1) firstView = view
    latestView = view
    return null
  }
  await renderComponent(<Probe2 />, { width: 80, height: 24 })
  await act(async () => {
    pushActivity()
  })
  await act(async () => {})
  // A real input change MUST break the memo — a view frozen across input
  // changes would wear a stale glyph.
  expect(latestView).not.toBe(firstView)
})
