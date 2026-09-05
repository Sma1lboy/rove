/** @jsxImportSource @opentui/react */
/**
 * The PR check-resolution toast's WIRING, through the real host.
 *
 * The daemon has always persisted and broadcast `task.prStatus.checkState`;
 * for a long time nothing in the TUI subscribed, so a CI run finishing was
 * silent. `usePrCheckNotifier` is that subscriber, and deleting its one call
 * in `host.tsx` is not a type error — it is a toast that quietly stops
 * appearing. So this mounts `WorkspaceRoot` and drives the tasks signal the
 * daemon writes, the same way host-worktree-gone-toast does.
 *
 * The two edges asserted here are the whole rule: `none → pending` ("CI
 * started") must stay quiet, `pending → failing` must announce itself once. A
 * test against `checkResolutionNotify` alone already covers the rule and would
 * stay green with the subscription deleted, which is why this one exists.
 *
 * As in the sibling test, the selected task deliberately has NO worktree —
 * TerminalTabs would mount PTYs and fs watchers that outlive the test in this
 * single-process track.
 */

import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import { createStateCell } from "../../src/lib/external-store"
import { WorkspaceRoot } from "../../src/tui-react/workspace/host"
import { setUiEventReporter } from "../../src/tui-react/workspace/terminal-tabs-shared"
import { type PRCheckState, type Task, toTaskId } from "../../src/types/task"
import { act, renderComponent, settle } from "./harness"

let previousHome: string | undefined

beforeAll(() => {
  previousHome = process.env.KOBE_HOME_DIR
  process.env.KOBE_HOME_DIR = mkdtempSync(join(tmpdir(), "kobe-pr-checks-"))
})

afterAll(() => {
  if (previousHome === undefined) Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
  else process.env.KOBE_HOME_DIR = previousHome
})

afterEach(() => {
  setUiEventReporter(null)
})

// `useAccessor` re-renders on snapshot IDENTITY change, so every constant is
// hoisted — a getter returning a fresh value each call spins forever.
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

/** What the poller writes: an open PR whose checks are at `checkState`. */
function withChecks(checkState: PRCheckState): Task {
  return task("beta", {
    prStatus: { provider: "github", lifecycle: "open", checkState, number: 7 },
  })
}

/** The task the user is sitting on. No worktree, so no TerminalTabs mount. */
const HELD = task("held", { worktreePath: "" })

function fakeOrchestrator(initial: readonly Task[]) {
  const tasks = createStateCell<readonly Task[]>(initial)
  const orchestrator = {
    tasksSignal: () => tasks,
    listTasks: () => tasks(),
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
    tabRenameStore: () => NULL_CELL,
    uiPromptStore: () => NULL_CELL,
    noticeStore: () => NULL_CELL,
    reportUiEvent: () => {},
    reportEngineInterrupt: () => {},
  } as unknown as RemoteOrchestrator
  return { orchestrator, tasks }
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1
}

test("checks resolving on an unselected task raise the host's toast — starting is silent", async () => {
  const { orchestrator, tasks } = fakeOrchestrator([HELD, withChecks("none")])
  const { frame } = await renderComponent(<WorkspaceRoot orchestrator={orchestrator} />, {
    width: 80,
    height: 24,
    providers: { kv: true, focus: true, dialog: true, notifications: true },
  })
  await settle(120)
  expect(await frame()).not.toContain("Checks")

  // CI starts. Not a resolution — the user learns nothing from being told a
  // run began, and this is the flap the rule exists to swallow.
  await act(async () => {
    tasks.set([HELD, withChecks("pending")])
  })
  await settle(120)
  expect(await frame()).not.toContain("Checks")

  // CI lands red: the edge worth interrupting for.
  await act(async () => {
    tasks.set([HELD, withChecks("failing")])
  })
  await settle(120)
  const text = await frame()
  expect(text).toContain('Checks failed for "beta"')
  // The body names WHICH pr — the sidebar chip can't, and a parallel-task user
  // has several in flight.
  expect(text).toContain("#7")

  // A re-broadcast snapshot sitting at the same state is not a second edge.
  await act(async () => {
    tasks.set([HELD, withChecks("failing")])
  })
  await settle(120)
  expect(occurrences(await frame(), "Checks failed")).toBe(1)
})
