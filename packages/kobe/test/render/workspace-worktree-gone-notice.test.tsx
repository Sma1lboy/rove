/** @jsxImportSource @opentui/react */
/**
 * A task whose worktree disappears out-of-band (another client, the worktrees
 * page, another agent's `rove api`) has ALL of its terminal tabs dropped — its
 * PTYs released and its persisted snapshot deleted. That was silent, which is
 * how "the tab I was working in just vanished" reached the owner with nothing
 * to look at (2026-08-29). It must announce itself.
 *
 * Deliberately NOT a confirm dialog: the worktree is already gone by the time
 * this runs, so there is nothing left to consent to.
 */

import { describe, expect, it } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { useCallback, useEffect, useState } from "react"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import { createStateCell } from "../../src/lib/external-store"
import { terminalTabsKey } from "../../src/tui-react/workspace/terminal-tabs-persist"
import { type WorktreeGoneEvent, useWorkspaceSelection } from "../../src/tui-react/workspace/use-workspace-selection"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"
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

describe("a worktree vanishing under a live task", () => {
  it("reports the dropped tabs instead of closing them silently", async () => {
    process.env.KOBE_HOME_DIR = mkdtempSync(join(tmpdir(), "kobe-wt-gone-"))
    const store: Record<string, unknown> = {
      // Two tabs the user was working in.
      [terminalTabsKey("alpha")]: {
        tabs: [
          { kind: "engine", id: "tab-1", title: null, ordinal: 1 },
          { kind: "engine", id: "tab-2", title: null, ordinal: 2 },
        ],
        activeId: "tab-1",
        nextOrdinal: 3,
      },
    }
    const kv = {
      store,
      set: (key: string, value: unknown) => {
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
    // Baseline: nothing announced, snapshot intact.
    expect(events).toEqual([])
    expect(store[terminalTabsKey("alpha")]).toBeDefined()

    // The worktree is removed elsewhere: the task survives, its path is cleared.
    act(() => removeWorktree?.())
    await settle()

    // The tabs really are dropped (the existing behavior) …
    expect(store[terminalTabsKey("alpha")]).toBeUndefined()
    // … and the user is told, with enough to know what they lost and that the
    // branch survived.
    expect(events.length).toBe(1)
    expect(events[0].taskId).toBe("alpha")
    expect(events[0].title).toBe("work on alpha")
    expect(events[0].branch).toBe("feat/alpha")
    expect(events[0].closed).toBe(2)
  })
})
