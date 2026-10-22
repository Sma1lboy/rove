/** @jsxImportSource @opentui/react */
/**
 * A task whose worktree disappears out-of-band (another client, the worktrees
 * page, another agent's `rove api`) has ALL of its terminal tabs dropped — its
 * PTYs released and its tabs gone from this TUI's view (the daemon owns the
 * persisted record; this TUI never writes the kv tabs key). Silently, that reads as
 * "the tab I was working in just vanished" with nothing to look at. It must
 * announce itself.
 *
 * Deliberately NOT a confirm dialog: the worktree is already gone by the time
 * this runs, so there is nothing left to consent to.
 */

import { afterEach, beforeEach, describe, expect, it, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { useCallback, useEffect, useState } from "react"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import { createStateCell } from "../../src/lib/external-store"
import { resetTabsSyncForTests } from "../../src/tui-react/workspace/tabs-sync"
import { tabsByTask } from "../../src/tui-react/workspace/terminal-tabs-shared"
import { type WorktreeGoneEvent, useWorkspaceSelection } from "../../src/tui-react/workspace/use-workspace-selection"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"
import { type TabsSyncDaemon, attachTabsDaemon } from "../tui-react/tabs-sync-daemon"
import { act, renderComponent, settle } from "./harness"

function task(id: string, worktreePath: string): Task {
  return {
    id: toTaskId(id),
    title: `work on ${id}`,
    repo: "/repos/rove",
    branch: `feat/${id}`,
    worktreePath,
    kind: "task",
    status: "in_progress",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  }
}

function mockOrchestrator() {
  const activeCell = createStateCell<string | null>(null)
  return {
    activeTaskSignal: () => activeCell,
    setActiveTask: () => Promise.resolve(),
    ensureWorktree: () => Promise.resolve(),
    reportUiEvent: () => {},
  } as unknown as RemoteOrchestrator
}

/** Drives the worktree-path change through state so one mount observes the
 *  non-empty → empty transition the hook keys off. */
function Probe(props: {
  kv: { store: Record<string, unknown>; set: (key: string, value: unknown) => void }
  onGone: (event: WorktreeGoneEvent) => void
  onReady: (removeWorktree: () => void) => void
}) {
  const [worktreePath, setWorktreePath] = useState("/wt/alpha")
  useWorkspaceSelection({
    orch: mockOrchestrator(),
    tasks: [task("alpha", worktreePath)],
    activeTaskId: null,
    focusWorkspace: () => {},
    kv: props.kv,
    notifyWorktreeGone: props.onGone,
  })
  useEffect(() => {
    props.onReady(() => setWorktreePath(""))
  }, [props.onReady])
  return null
}

/** Stable prop identities so the probe's ready-effect runs once. */
function Harness(props: {
  kv: { store: Record<string, unknown>; set: (key: string, value: unknown) => void }
  onGone: (event: WorktreeGoneEvent) => void
  onReady: (removeWorktree: () => void) => void
}) {
  const onGone = useCallback(props.onGone, [])
  const onReady = useCallback(props.onReady, [])
  return <Probe kv={props.kv} onGone={onGone} onReady={onReady} />
}

let daemon: TabsSyncDaemon

beforeEach(async () => {
  resetTabsSyncForTests()
  // Two tabs the user was working in, as the daemon holds them.
  daemon = await attachTabsDaemon({
    alpha: {
      tabs: [
        { kind: "engine", id: "tab-1", title: null, ordinal: 1 },
        { kind: "engine", id: "tab-2", title: null, ordinal: 2 },
      ],
      activeId: "tab-1",
      nextOrdinal: 3,
    },
  })
})

afterEach(() => daemon.detach())

/** Mount the probe, then remove alpha's worktree out-of-band. */
async function vanish(): Promise<{ events: WorktreeGoneEvent[]; writes: string[] }> {
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-wt-gone-"))
  const store: Record<string, unknown> = {}
  const writes: string[] = []
  const kv = {
    store,
    set: (key: string, value: unknown) => {
      writes.push(key)
      if (value === undefined) delete store[key]
      else store[key] = value
    },
  }
  const events: WorktreeGoneEvent[] = []

  let removeWorktree: (() => void) | null = null
  await renderComponent(
    <Harness
      kv={kv}
      onGone={(e) => events.push(e)}
      onReady={(fn) => {
        removeWorktree = fn
      }}
    />,
    { width: 46, height: 10 },
  )
  await settle()
  // Baseline: nothing announced, tabs intact.
  expect(events).toEqual([])
  expect(tabsByTask.get("alpha")?.tabs).toHaveLength(2)

  // The worktree is removed elsewhere: the task survives, its path is cleared.
  act(() => removeWorktree?.())
  await settle()
  return { events, writes }
}

describe("a worktree vanishing under a live task", () => {
  it("reports the dropped tabs instead of closing them silently", async () => {
    const { events, writes } = await vanish()

    // The tabs really are dropped from this TUI's view (the existing behavior) …
    expect(tabsByTask.has("alpha")).toBe(false)
    // … and the user is told, with enough to know what they lost and that the
    // branch survived.
    expect(events.length).toBe(1)
    expect(events[0].taskId).toBe("alpha")
    expect(events[0].title).toBe("work on alpha")
    expect(events[0].branch).toBe("feat/alpha")
    expect(events[0].closed).toBe(2)
    // The kv tabs key is the daemon's.
    expect(writes.filter((key) => key.startsWith("terminalTabs."))).toEqual([])
  })

  // The worktree is gone for every client: its tabs leave the daemon too, not just this view.
  test("the daemon drops the vanished worktree's tabs too", async () => {
    await vanish()
    expect(daemon.tabs("alpha")).toBeUndefined()
  })
})
