/** @jsxImportSource @opentui/react */
/**
 * Archiving the task on screen leaves nothing selected (the host shows New task), and no
 * other task is picked in its place. An archived task the user opens from the Archived fold stays open.
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
import { useWorkspaceSelection } from "../../src/tui-react/workspace/use-workspace-selection"
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

test("archiving the open task leaves nothing selected; opening an archived one keeps it", async () => {
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-archive-select-"))
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
  let selectTask: (id: string) => void = () => {}
  let selectedId = null as string | null
  let left = 0
  function Probe() {
    const [tasks, set] = useState<Task[]>([task("alpha"), task("bravo", { updatedAt: "2026-08-02T00:00:00.000Z" })])
    setTasks = set
    const selection = useWorkspaceSelection({
      orch,
      tasks,
      activeTaskId: active(),
      focusWorkspace: () => {},
      kv: KV,
      onSelectedLeft: () => left++,
    })
    selectTask = selection.selectTask
    selectedId = selection.selectedId
    return null
  }
  await renderComponent(<Probe />, { width: 40, height: 6 })
  await act(async () => {})
  expect(selectedId).toBe("alpha")

  await act(async () =>
    setTasks([task("alpha", { archived: true }), task("bravo", { updatedAt: "2026-08-02T00:00:00.000Z" })]),
  )
  expect(selectedId).toBeNull()
  expect(left).toBe(1)

  await act(async () => selectTask("alpha"))
  expect(selectedId).toBe("alpha")
})
