/** @jsxImportSource @opentui/react */
/**
 * Below the narrow breakpoint the sidebar is off screen while a task is open,
 * so the workspace must carry a visible, clickable way back to the task list.
 * Mounted through the REAL `WorkspaceRoot`: the click has to beat the content
 * pane's own focus-grab, which only the real host wires up.
 */

import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import { createStateCell } from "../../src/lib/external-store"
import { WorkspaceRoot } from "../../src/tui-react/workspace/host"
import { setUiEventReporter } from "../../src/tui-react/workspace/terminal-tabs-shared"
import { act, renderComponent, settle } from "./harness"

// KVProvider persists to `$ROVE_HOME_DIR`; per-file, see host-version-skew-banner.test.tsx.
let previousHome: string | undefined
beforeAll(() => {
  previousHome = process.env.ROVE_HOME_DIR
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-narrow-back-"))
})
afterAll(() => {
  if (previousHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = previousHome
})
afterEach(() => {
  setUiEventReporter(null)
})

// Snapshots must keep identity across reads, or useSyncExternalStore spins.
const NULL_CELL = createStateCell(null)
const EMPTY_MAP = createStateCell(new Map())
const EMPTY_ARR = createStateCell(Object.freeze([]))
// No worktreePath: the workspace shows its empty state instead of mounting terminals.
const TASK = Object.freeze({ id: "t1", title: "Phone task", branch: "rove/t1", vendor: "claude", repo: "/repo/x" })
const TASKS = createStateCell(Object.freeze([TASK]))
const ACTIVE = createStateCell("t1")

function fakeOrchestrator(): RemoteOrchestrator {
  return {
    connectionStateSignal: () => createStateCell("online"),
    staleInstallSignal: () => NULL_CELL,
    daemonStaleSignal: () => createStateCell(false),
    daemonVersionSignal: () => NULL_CELL,
    daemonRestartingSignal: () => createStateCell(false),
    tasksSignal: () => TASKS,
    activeTaskSignal: () => ACTIVE,
    engineStateSignal: () => EMPTY_MAP,
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
    uiPromptStore: () => NULL_CELL,
    noticeStore: () => NULL_CELL,
    reportUiEvent: () => {},
    reportEngineInterrupt: () => {},
    listTasks: () => [TASK],
  } as unknown as RemoteOrchestrator
}

test("a narrow workspace shows a back row whose click returns to the task list", async () => {
  const { frame, mockMouse } = await renderComponent(<WorkspaceRoot orchestrator={fakeOrchestrator()} />, {
    width: 46,
    height: 30,
    providers: { kv: true, focus: true, dialog: true, notifications: true },
  })
  await settle(120)
  // Focus the workspace the way a user does: click into it.
  await act(async () => {
    await mockMouse.click(23, 15)
  })
  await settle(60)
  const workspace = await frame()
  expect(workspace).toContain("‹ Tasks")
  expect(workspace).not.toContain("New task")

  const lines = workspace.split("\n")
  const row = lines.findIndex((line) => line.includes("‹ Tasks"))
  await act(async () => {
    await mockMouse.click(lines[row]?.indexOf("‹ Tasks") ?? 0, row)
  })
  await settle(60)
  const list = await frame()
  expect(list).toContain("New task")
  expect(list).toContain("Phone task")
  expect(list).not.toContain("‹ Tasks")
})
