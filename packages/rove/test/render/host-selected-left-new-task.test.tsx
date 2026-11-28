/** @jsxImportSource @opentui/react */
/** The selected session archived, deleted or gone opens the global New task, through the real host; another one leaving changes nothing. */

import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { RemoteOrchestrator } from "@sma1lboy/rove-client/client/remote-orchestrator.ts"
import { createStateCell } from "@sma1lboy/rove-core/lib/external-store.ts"
import { WorkspaceRoot } from "../../src/tui-react/workspace/host"
import { setUiEventReporter } from "../../src/tui-react/workspace/terminal-tabs-shared"
import { act, renderComponent, settle, waitForFrameText } from "./harness"

let previousHome: string | undefined
beforeAll(() => {
  previousHome = process.env.ROVE_HOME_DIR
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-selected-left-"))
})
afterAll(() => {
  if (previousHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = previousHome
})
afterEach(() => setUiEventReporter(null))

const NULL_CELL = createStateCell(null)
const EMPTY_MAP = createStateCell(new Map())
const EMPTY_ARR = createStateCell(Object.freeze([]))
// No worktreePath: the workspace shows its empty state instead of mounting terminals.
const OPEN = Object.freeze({ id: "t1", title: "Fix the flaky login", repo: "/tmp/repo", branch: "b", kind: "dir" })
const OTHER = Object.freeze({ id: "t2", title: "Tidy the docs", repo: "/tmp/repo", branch: "c", kind: "dir" })

async function host() {
  const tasks = createStateCell<readonly object[]>(Object.freeze([OPEN, OTHER]))
  const active = createStateCell<string | null>("t1")
  const orchestrator = {
    connectionStateSignal: () => createStateCell("online"),
    staleInstallSignal: () => NULL_CELL,
    daemonStaleSignal: () => createStateCell(false),
    daemonVersionSignal: () => NULL_CELL,
    daemonRestartingSignal: () => createStateCell(false),
    tasksSignal: () => tasks,
    activeTaskSignal: () => active,
    setActiveTask: (id: string | null) => {
      active.set(id)
      return Promise.resolve()
    },
    engineStateSignal: () => createStateCell(new Map([["t1", Object.freeze({ state: "running" })]])),
    engineLifecycleSignal: () => EMPTY_MAP,
    engineTabStatesSignal: () => EMPTY_MAP,
    attentionInboxSignal: () => EMPTY_ARR,
    taskJobsSignal: () => EMPTY_MAP,
    rowTokensSignal: () => EMPTY_MAP,
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
    tabAddStore: () => NULL_CELL,
    uiPromptStore: () => NULL_CELL,
    noticeStore: () => NULL_CELL,
    reportUiEvent: () => {},
    reportEngineInterrupt: () => {},
    listTasks: () => tasks(),
  } as unknown as RemoteOrchestrator
  const { frame, mockInput } = await renderComponent(<WorkspaceRoot orchestrator={orchestrator} />, {
    width: 120,
    height: 40,
    providers: { kv: true, focus: true, dialog: true, notifications: true },
  })
  await waitForFrameText(frame, "Fix the flaky login · running")
  const list = (next: readonly object[]) => act(async () => tasks.set(Object.freeze(next)))
  return { frame, mockInput, list, active }
}

for (const [how, after] of [
  ["archived", [{ ...OPEN, archived: true }, OTHER]],
  ["being deleted", [{ ...OPEN, deletion: { status: "pending" } }, OTHER]],
  ["deleted here, from another client or the CLI", [OTHER]],
] as const) {
  test(`the selected session ${how} opens New task on No folder, and the page takes the keys`, async () => {
    const { frame, mockInput, list, active } = await host()
    await list(after)
    const page = await waitForFrameText(frame, "Choose folder")
    expect(page).toContain("Describe a task")
    expect(page).not.toContain("· running")
    expect(active()).toBeNull()
    await mockInput.typeText("next one")
    expect(await frame()).toContain("next one")
  })
}

test("archiving a session that is not selected leaves the selected one on screen", async () => {
  const { frame, list } = await host()
  await list([OPEN, { ...OTHER, archived: true }])
  await settle(200)
  const screen = await frame()
  expect(screen).toContain("Fix the flaky login · running")
  expect(screen).not.toContain("Describe a task")
})
