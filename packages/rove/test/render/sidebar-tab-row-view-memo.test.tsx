/** @jsxImportSource @opentui/react */
/** `useTabRowBaseView` (tree-rows.tsx): the tab's own state wins over legacy fields. */

import { expect, test } from "bun:test"
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

test("a directory transcript cannot resurrect a completed tab", async () => {
  // An object, not two `let`s: a `let` assigned only inside the component
  // reads as its initializer to control-flow analysis, which turns both
  // assertions into compile errors. Both fields start absent, so a probe
  // that never ran fails rather than matching by accident.
  const seen: { done?: boolean; working?: boolean } = {}
  const completedAt = 10_000
  function Probe3() {
    // Extra legacy fields cannot override the tab's authoritative state.
    seen.done = useTabRowBaseView({
      task: TASK,
      activity: { state: "turn_complete", at: completedAt },
      lifecycle: undefined,
      job: undefined,
      completionSeen: false,
    }).loading
    seen.working = useTabRowBaseView({
      task: TASK,
      activity: { state: "turn_complete", at: completedAt },
      lifecycle: undefined,
      job: undefined,
      // A sibling wrote after this tab completed.
      ...{ transcript: { mtimeMs: completedAt + 60_000 } },
      completionSeen: false,
    }).loading
    return null
  }
  await renderComponent(<Probe3 />, { width: 80, height: 24 })
  expect(seen.done).toBe(false)
  expect(seen.working).toBe(false)
})
