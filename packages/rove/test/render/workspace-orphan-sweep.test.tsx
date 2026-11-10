/** @jsxImportSource @opentui/react */
/**
 * Orphan `terminalTabs.*` records (a task deleted by a sibling client, or while
 * no daemon ran) are the DAEMON's to sweep now (`TabsStore.sweep`, pinned in
 * test/daemon/tabs-store.test.ts, including its never-on-an-empty-list guard).
 * useWorkspaceSelection used to sweep the kv on every task-list change; a TUI
 * writing those keys is the multi-writer race the daemon exists to end. This
 * probe pins that a task-list change — a foreign delete, or the empty list of a
 * pre-connection render — writes no tabs key from the TUI at all.
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

/** Fake kv: `set(k, undefined)` deletes the key, matching kv-core; records every key written. */
function fakeKv(initial: Record<string, unknown> = {}): TabsSnapshotKv & { writes: string[] } {
  const store: Record<string, unknown> = { ...initial }
  const writes: string[] = []
  return {
    store,
    writes,
    set(key, value) {
      writes.push(key)
      if (value === undefined) delete store[key]
      else store[key] = value
    },
  }
}

const tabsWrites = (kv: { writes: string[] }) => kv.writes.filter((key) => key.startsWith("terminalTabs."))

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

const savedHome = process.env.ROVE_HOME_DIR

test("a task deleted by a sibling client leaves its tabs record to the daemon — the TUI writes no tabs key", async () => {
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-orphan-sweep-"))
  const kv = fakeKv({
    [terminalTabsKey("alpha")]: { tabs: [] },
    [terminalTabsKey("bravo")]: { tabs: [] },
  })
  await renderComponent(<Probe orch={mockOrchestrator()} kv={kv} initial={[task("alpha"), task("bravo")]} />, {
    width: 80,
    height: 24,
  })
  await act(async () => {})

  // Sibling client deletes bravo: the change arrives as a new list identity.
  await act(async () => {
    setTasksList([task("alpha")])
  })
  // A later re-render with a FRESH array identity.
  await act(async () => {
    setTasksList([task("alpha")])
  })
  expect(tabsWrites(kv)).toEqual([])
  expect(kv.store[terminalTabsKey("alpha")]).toEqual({ tabs: [] })

  if (savedHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = savedHome
})

test("an empty task list writes no tabs key either", async () => {
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-orphan-sweep-empty-"))
  const kv = fakeKv({
    [terminalTabsKey("alpha")]: { tabs: [] },
  })
  await renderComponent(<Probe orch={mockOrchestrator()} kv={kv} initial={[]} />, { width: 80, height: 24 })
  await act(async () => {
    setTasksList([])
  })
  // Empty is the shape of a pre-connection render AND a corrupt-manifest
  // recovery; nothing here may wipe a live record.
  expect(tabsWrites(kv)).toEqual([])
  expect(kv.store[terminalTabsKey("alpha")]).toEqual({ tabs: [] })

  if (savedHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = savedHome
})
