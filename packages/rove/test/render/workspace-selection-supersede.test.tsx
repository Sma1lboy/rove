/** @jsxImportSource @opentui/react */
/**
 * A worktree activation that resolves after the user picked another task
 * (an Inbox jump, a rail click) leaves the newer pick selected.
 */

import { afterEach, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createStateCell } from "@sma1lboy/rove-core/lib/external-store.ts"
import type { Task } from "@sma1lboy/rove-core/types/task.ts"
import { toTaskId } from "@sma1lboy/rove-core/types/task.ts"
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
const TASKS = [task("alpha"), task("bravo"), task("charlie", { worktreePath: "" })]
const priorHome = process.env.ROVE_HOME_DIR
afterEach(() => {
  if (priorHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = priorHome
})

test("a direct pick made while another task's worktree is materializing wins", async () => {
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-selection-supersede-"))
  const active = createStateCell<string | null>("alpha")
  let finishWorktree: () => void = () => {}
  const orch = {
    activeTaskSignal: () => active,
    setActiveTask: (id: string) => {
      active.set(id)
      return Promise.resolve()
    },
    ensureWorktree: () =>
      new Promise<void>((resolve) => {
        finishWorktree = resolve
      }),
    reportUiEvent: () => {},
  } as unknown as RemoteOrchestrator
  let selection = null as WorkspaceSelection | null
  function Probe() {
    selection = useWorkspaceSelection({ orch, tasks: TASKS, activeTaskId: active(), focusWorkspace: () => {}, kv: KV })
    return null
  }
  await renderComponent(<Probe />, { width: 40, height: 6 })
  await act(async () => {})
  expect(selection?.selectedId).toBe("alpha")

  let activation: Promise<void> | undefined
  await act(async () => {
    activation = selection?.activateTask("charlie")
  })
  await act(async () => selection?.selectTask("bravo"))
  await act(async () => {
    finishWorktree()
    await activation
  })
  expect(selection?.selectedId).toBe("bravo")
})
