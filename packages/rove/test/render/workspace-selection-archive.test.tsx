/** @jsxImportSource @opentui/react */
/**
 * Archiving the task on screen moves the workspace off it, as a delete does;
 * before, the archived task stayed open on the right. An archived task the
 * user opens from the Archived fold must stay open, though.
 */

import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { useState } from "react"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import { createStateCell } from "../../src/lib/external-store"
import { useWorkspaceSelection } from "../../src/tui-react/workspace/use-workspace-selection"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"
import { act, renderComponent, settle } from "./harness"

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

test("archiving the open task leaves it; opening an archived one keeps it", async () => {
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
  function Probe() {
    const [tasks, set] = useState<Task[]>([task("alpha"), task("bravo", { updatedAt: "2026-08-02T00:00:00.000Z" })])
    setTasks = set
    const selection = useWorkspaceSelection({ orch, tasks, activeTaskId: active(), focusWorkspace: () => {}, kv: KV })
    selectTask = selection.selectTask
    selectedId = selection.selectedId
    return null
  }
  await renderComponent(<Probe />, { width: 40, height: 6 })
  await settle()
  expect(selectedId).toBe("alpha")

  act(() => setTasks([task("alpha", { archived: true }), task("bravo", { updatedAt: "2026-08-02T00:00:00.000Z" })]))
  await settle()
  expect(selectedId).toBe("bravo")

  act(() => selectTask("alpha"))
  await settle()
  expect(selectedId).toBe("alpha")
})
