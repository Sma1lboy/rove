/** @jsxImportSource @opentui/react */
/**
 * "Back to the previous task" returns to the task the user left, swaps on a
 * second press, and refuses once that task is archived.
 */

import { afterEach, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createStateCell } from "@sma1lboy/rove-core/lib/external-store.ts"
import type { Task } from "@sma1lboy/rove-core/types/task.ts"
import { toTaskId } from "@sma1lboy/rove-core/types/task.ts"
import { useState } from "react"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import { type WorkspaceSelection, useWorkspaceSelection } from "../../src/tui-react/workspace/use-workspace-selection"
import { act, renderComponent } from "./harness"

function task(id: string, over: Partial<Task> = {}): Task {
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
    ...over,
  }
}

const KV = { store: {}, set: () => {} }
const priorHome = process.env.ROVE_HOME_DIR
afterEach(() => {
  if (priorHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = priorHome
})

test("back to the previous task toggles between the last two and skips an archived one", async () => {
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-previous-task-"))
  const active = createStateCell<string | null>("alpha")
  const orch = {
    activeTaskSignal: () => active,
    setActiveTask: (id: string) => {
      active.set(id)
      return Promise.resolve()
    },
    ensureWorktree: () => Promise.resolve(),
    reportUiEvent: () => {},
  } as unknown as RemoteOrchestrator
  let setTasks: (tasks: Task[]) => void = () => {}
  let selection = null as WorkspaceSelection | null
  function Probe() {
    const [tasks, set] = useState<Task[]>([task("alpha"), task("bravo"), task("charlie")])
    setTasks = set
    selection = useWorkspaceSelection({ orch, tasks, activeTaskId: active(), focusWorkspace: () => {}, kv: KV })
    return null
  }
  await renderComponent(<Probe />, { width: 40, height: 6 })
  await act(async () => {})
  expect(selection?.selectedId).toBe("alpha")
  expect(selection?.backToPreviousTask()).toBe(false)

  await act(async () => selection?.selectTask("bravo"))
  await act(async () => selection?.selectTask("charlie"))
  await act(async () => {
    expect(selection?.backToPreviousTask()).toBe(true)
  })
  expect(selection?.selectedId).toBe("bravo")
  await act(async () => {
    selection?.backToPreviousTask()
  })
  expect(selection?.selectedId).toBe("charlie")

  await act(async () => setTasks([task("alpha"), task("bravo", { archived: true }), task("charlie")]))
  expect(selection?.backToPreviousTask()).toBe(false)
  expect(selection?.selectedId).toBe("charlie")
})
