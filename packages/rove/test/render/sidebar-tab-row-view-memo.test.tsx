/** @jsxImportSource @opentui/react */
/** `useTabRowBaseView` (tree-rows.tsx): the row view is the daemon's status, memoized on it. */

import { expect, test } from "bun:test"
import type { RowStatus } from "@sma1lboy/rove-daemon/daemon/row-status"
import { useTabRowBaseView } from "../../src/tui-react/panes/sidebar/tree-rows"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"
import { renderComponent } from "./harness"

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

test("a finished turn the daemon reports does not spin, and the same status keeps the same view", async () => {
  // An object, not `let`s: a `let` assigned only inside the component reads as
  // its initializer to control-flow analysis. Fields start absent, so a probe
  // that never ran fails rather than matching by accident.
  const seen: { done?: boolean; same?: boolean; running?: boolean } = {}
  const done: RowStatus = { kind: "unseen", since: 10_000, state: "turn_complete" }
  const running: RowStatus = { kind: "running", since: 10_000, state: "running" }
  function Probe() {
    const a = useTabRowBaseView({ task: TASK, status: done, lifecycle: undefined })
    const b = useTabRowBaseView({ task: TASK, status: done, lifecycle: undefined })
    seen.done = a.loading
    seen.same = a.stateGlyph === b.stateGlyph && a.tone === b.tone
    seen.running = useTabRowBaseView({ task: TASK, status: running, lifecycle: undefined }).loading
    return null
  }
  await renderComponent(<Probe />, { width: 80, height: 24 })
  expect(seen.done).toBe(false)
  expect(seen.same).toBe(true)
  expect(seen.running).toBe(true)
})
