/** @jsxImportSource @opentui/react */
/**
 * Orphan-sweep timing in useWorkspaceSelection: the sweep of `terminalTabs.*`
 * snapshots whose task is gone must run on EVERY task-list identity change,
 * not once per session. forgetTaskTabs only fires for THIS client's delete
 * flow — a sibling client (`rove api` / web board) removing a task lands here
 * purely as a changed list, and a once-per-session ref leaves those orphans on
 * disk until the next launch, taxing every later kv write. This probe seeds two snapshots, then removes
 * a task from the list the way a foreign delete does, and pins the sweep to
 * follow THAT change — plus the load-bearing `tasks.length === 0` guard.
 */

import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { useEffect, useState } from "react"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import { createStateCell } from "../../src/lib/external-store"
import { type TabsSnapshotKv, terminalTabsKey } from "../../src/tui-react/workspace/terminal-tabs-persist"
import { useWorkspaceSelection } from "../../src/tui-react/workspace/use-workspace-selection"
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

/** Fake kv: `set(k, undefined)` deletes the key, matching kv-core. */
function fakeKv(initial: Record<string, unknown> = {}): TabsSnapshotKv {
  const store: Record<string, unknown> = { ...initial }
  return {
    store,
    set(key, value) {
      if (value === undefined) delete store[key]
      else store[key] = value
    },
  }
}

function mockOrchestrator(): RemoteOrchestrator {
  return {
    activeTaskSignal: () => createStateCell<string | null>(null),
    setActiveTask: () => Promise.resolve(),
    ensureWorktree: () => Promise.resolve(),
    reportUiEvent: () => {},
  } as unknown as RemoteOrchestrator
}

let setTasksList: (tasks: Task[]) => void = () => {}

function Probe(props: { orch: RemoteOrchestrator; kv: TabsSnapshotKv; initial: Task[] }) {
  const [tasks, setTasks] = useState(props.initial)
  useEffect(() => {
    setTasksList = setTasks
  }, [])
  useWorkspaceSelection({
    orch: props.orch,
    tasks,
    activeTaskId: null,
    focusWorkspace: () => {},
    kv: props.kv,
  })
  return null
}

const savedHome = process.env.KOBE_HOME_DIR

test("a task deleted by a sibling client is swept on the next task-list change, without touching live snapshots", async () => {
  process.env.KOBE_HOME_DIR = mkdtempSync(join(tmpdir(), "kobe-orphan-sweep-"))
  const kv = fakeKv({
    [terminalTabsKey("alpha")]: { tabs: [] },
    [terminalTabsKey("bravo")]: { tabs: [] },
  })
  await renderComponent(<Probe orch={mockOrchestrator()} kv={kv} initial={[task("alpha"), task("bravo")]} />, {
    width: 80,
    height: 24,
  })
  await act(async () => {})
  // Both tasks are live — the sweep ran and removed nothing.
  expect(kv.store[terminalTabsKey("alpha")]).toEqual({ tabs: [] })
  expect(kv.store[terminalTabsKey("bravo")]).toEqual({ tabs: [] })

  // Sibling client deletes bravo: the change arrives as a new list identity.
  await act(async () => {
    setTasksList([task("alpha")])
  })
  expect(kv.store[terminalTabsKey("bravo")]).toBeUndefined()
  expect(kv.store[terminalTabsKey("alpha")]).toEqual({ tabs: [] })

  // A later re-render with a FRESH array identity re-sweeps (idempotent) and
  // still cannot touch a live task's snapshot.
  await act(async () => {
    setTasksList([task("alpha")])
  })
  expect(kv.store[terminalTabsKey("alpha")]).toEqual({ tabs: [] })

  if (savedHome === undefined) Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
  else process.env.KOBE_HOME_DIR = savedHome
})

test("an empty task list sweeps nothing — the guard is load-bearing", async () => {
  process.env.KOBE_HOME_DIR = mkdtempSync(join(tmpdir(), "kobe-orphan-sweep-empty-"))
  const kv = fakeKv({
    [terminalTabsKey("alpha")]: { tabs: [] },
  })
  await renderComponent(<Probe orch={mockOrchestrator()} kv={kv} initial={[]} />, { width: 80, height: 24 })
  await act(async () => {
    setTasksList([])
  })
  // Empty is the shape of a pre-connection render AND a corrupt-manifest
  // recovery; sweeping on it would wipe every live snapshot on the machine.
  expect(kv.store[terminalTabsKey("alpha")]).toEqual({ tabs: [] })

  if (savedHome === undefined) Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
  else process.env.KOBE_HOME_DIR = savedHome
})
