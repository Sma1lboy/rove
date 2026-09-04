/** @jsxImportSource @opentui/react */
/**
 * The worktree-gone toast's WIRING, through the real host.
 *
 * `useWorkspaceSelection` takes `notifyWorktreeGone` as an OPTIONAL argument,
 * so dropping the host's wire is not a type error — it is a toast that
 * silently stops appearing, for an event the user did not cause and has
 * nothing else to look at. (Its siblings notifyError/notifyInfo/
 * notifyNeedsInput are required parameters on every consumer, so those wires
 * are held by the typechecker; this one is not.) A test against
 * `useHostNotifiers` alone would stay green with the wire deleted, which is
 * why this mounts `WorkspaceRoot` and drives the tasks signal the daemon
 * writes.
 *
 * The selected task deliberately has NO worktree: `ShowWorkspace` mounts
 * TerminalTabs (PTYs, fs watchers) as soon as one is selected with a
 * worktree path, and those outlive the test in this single-process track.
 * A second task losing its worktree while you sit on another is also the
 * shape the toast is written for — the event arrives from somewhere else.
 */

import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import { createStateCell } from "../../src/lib/external-store"
import { WorkspaceRoot } from "../../src/tui-react/workspace/host"
import { setUiEventReporter } from "../../src/tui-react/workspace/terminal-tabs-shared"
import { type Task, toTaskId } from "../../src/types/task"
import { act, renderComponent, settle } from "./harness"

// Same per-FILE env capture as host-version-skew-banner: KVProvider persists
// to `$KOBE_HOME_DIR`, which is the real ~/.rove without this.
let previousHome: string | undefined

beforeAll(() => {
  previousHome = process.env.KOBE_HOME_DIR
  process.env.KOBE_HOME_DIR = mkdtempSync(join(tmpdir(), "kobe-worktree-gone-"))
})

afterAll(() => {
  if (previousHome === undefined) Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
  else process.env.KOBE_HOME_DIR = previousHome
})

// The host installs a module-level reporter closed over ITS orchestrator,
// and it outlives the unmount.
afterEach(() => {
  setUiEventReporter(null)
})

// `useAccessor` re-renders on snapshot IDENTITY change, so a getter returning
// a fresh value each call spins forever. Every constant below is hoisted.
const NULL_CELL = createStateCell(null)
const EMPTY_MAP = createStateCell(new Map())
const EMPTY_ARR = createStateCell(Object.freeze([]))

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

/** The task the user is sitting on. No worktree, so no TerminalTabs mount. */
const HELD = task("held", { worktreePath: "" })

function fakeOrchestrator(initial: readonly Task[]) {
  const tasks = createStateCell<readonly Task[]>(initial)
  const orchestrator = {
    tasksSignal: () => tasks,
    listTasks: () => tasks(),
    // Pin the selection: without a replayed focus the adopt effect picks by
    // recency, and which task is selected decides whether TerminalTabs mounts.
    activeTaskSignal: () => createStateCell<string | null>(HELD.id),
    setActiveTask: async () => {},
    connectionStateSignal: () => createStateCell("online"),
    staleInstallSignal: () => NULL_CELL,
    daemonStaleSignal: () => createStateCell(false),
    daemonVersionSignal: () => NULL_CELL,
    engineStateSignal: () => EMPTY_MAP,
    engineLifecycleSignal: () => EMPTY_MAP,
    engineTabStatesSignal: () => EMPTY_MAP,
    attentionInboxSignal: () => EMPTY_ARR,
    taskJobsSignal: () => EMPTY_MAP,
    worktreeChangesSignal: () => NULL_CELL,
    transcriptActivitySignal: () => NULL_CELL,
    transcriptActivityStore: () => NULL_CELL,
    usageSnapshotSignal: () => NULL_CELL,
    contextUsageSignal: () => NULL_CELL,
    uiPrefsSignal: () => NULL_CELL,
    keybindingsRevSignal: () => NULL_CELL,
    updateSignal: () => NULL_CELL,
    tabOpenStore: () => NULL_CELL,
    tabCloseStore: () => NULL_CELL,
    uiPromptStore: () => NULL_CELL,
    noticeStore: () => NULL_CELL,
    reportUiEvent: () => {},
    reportEngineInterrupt: () => {},
  } as unknown as RemoteOrchestrator
  return { orchestrator, tasks }
}

test("a worktree vanishing under an unselected task raises the host's toast", async () => {
  const { orchestrator, tasks } = fakeOrchestrator([HELD, task("beta")])
  const { frame } = await renderComponent(<WorkspaceRoot orchestrator={orchestrator} />, {
    width: 80,
    height: 24,
    providers: { kv: true, focus: true, dialog: true, notifications: true },
  })
  await settle(120)
  // Negative control: the toast must be raised BY the transition, not by
  // mounting a task that happens to have a worktree.
  expect(await frame()).not.toContain("is gone")

  // What the daemon actually sends when another client removes the worktree:
  // the task survives, its `worktreePath` empties.
  await act(async () => {
    tasks.set([HELD, task("beta", { worktreePath: "" })])
  })
  await settle(120)
  const text = await frame()
  expect(text).toContain('Worktree for "beta" is gone')
  // The remedy half of the message: the tabs are gone but the branch is not,
  // which is the only reason this is a toast and not a confirm.
  expect(text).toContain("Closed 0 tab")
})
