/** @jsxImportSource @opentui/react */
/** New task opened from a selected, running task, through the real host. */

import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import { createStateCell } from "../../src/lib/external-store"
import { WorkspaceRoot } from "../../src/tui-react/workspace/host"
import { setUiEventReporter } from "../../src/tui-react/workspace/terminal-tabs-shared"
import { renderComponent, waitForFrameText } from "./harness"

let previousHome: string | undefined
beforeAll(() => {
  previousHome = process.env.ROVE_HOME_DIR
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-new-task-page-"))
})
afterAll(() => {
  if (previousHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = previousHome
})
afterEach(() => setUiEventReporter(null))

const NULL_CELL = createStateCell(null)
const EMPTY_MAP = createStateCell(new Map())
const EMPTY_ARR = createStateCell(Object.freeze([]))
// No worktreePath: the workspace shows its empty state instead of mounting terminals, whose PTY
// connection would fail on the missing socket whenever it lost the race with the test.
const TASK = Object.freeze({
  id: "t1",
  title: "Fix the flaky login",
  repo: "/tmp/repo",
  branch: "b",
  kind: "dir",
})
const TASKS = createStateCell(Object.freeze([TASK]))
const ACTIVE = createStateCell("t1")
const RUNNING = createStateCell(new Map([["t1", Object.freeze({ state: "running" })]]))

const orchestrator = {
  connectionStateSignal: () => createStateCell("online"),
  staleInstallSignal: () => NULL_CELL,
  daemonStaleSignal: () => createStateCell(false),
  daemonVersionSignal: () => NULL_CELL,
  daemonRestartingSignal: () => createStateCell(false),
  tasksSignal: () => TASKS,
  activeTaskSignal: () => ACTIVE,
  engineStateSignal: () => RUNNING,
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
  listTasks: () => [TASK],
} as unknown as RemoteOrchestrator

test("clicking New task from a running task clears the task's title and takes the keys", async () => {
  const { frame, mockMouse, mockInput } = await renderComponent(<WorkspaceRoot orchestrator={orchestrator} />, {
    width: 120,
    height: 40,
    providers: { kv: true, focus: true, dialog: true, notifications: true },
  })
  const before = await waitForFrameText(frame, "Fix the flaky login · running")
  const row = before.split("\n").findIndex((line) => line.includes("New task"))
  await mockMouse.click(3, row)
  const opened = await waitForFrameText(frame, "Describe a task")
  expect(opened).not.toContain("· running")
  await mockInput.typeText("hello there")
  expect(await frame()).toContain("hello there")
})

test("the global New task opens on No folder and starts a no-folder session with the message, model and effort", async () => {
  let opened: (input: unknown) => void = () => {}
  const openCall = new Promise((resolve) => {
    opened = resolve
  })
  const orch = {
    ...orchestrator,
    // Never settles: the session's own entry is not what this pins.
    openDirectoryTask: (input: unknown) => {
      opened(input)
      return new Promise(() => {})
    },
  } as unknown as RemoteOrchestrator
  const { frame, mockMouse, mockInput } = await renderComponent(<WorkspaceRoot orchestrator={orch} />, {
    width: 120,
    height: 40,
    providers: { kv: true, focus: true, dialog: true, notifications: true },
  })
  const before = await waitForFrameText(frame, "Fix the flaky login · running")
  // The selected task's project is not guessed: the page opens on No folder.
  await mockMouse.click(
    3,
    before.split("\n").findIndex((line) => line.includes("New task")),
  )
  const page = await waitForFrameText(frame, "No folder")
  const at = (text: string, screen: string) => {
    const y = screen.split("\n").findIndex((line) => line.includes(text))
    return { x: (screen.split("\n")[y] ?? "").indexOf(text) + 1, y }
  }
  const model = at(" model ", page)
  await mockMouse.click(model.x, model.y)
  await mockInput.typeText("m-1")
  const effort = at(" effort ", await frame())
  await mockMouse.click(effort.x, effort.y)
  mockInput.pressArrow("right")
  const prompt = at("Describe a task", await frame())
  await mockMouse.click(prompt.x, prompt.y)
  await mockInput.typeText("hello there")
  mockInput.pressEnter()
  expect(await openCall).toEqual({
    dir: homedir(),
    scratch: true,
    vendor: expect.any(String),
    model: "m-1",
    modelEffort: expect.any(String),
  })
})

test("a project's + pressed while the New task page is open moves the page to that project", async () => {
  const { frame, mockMouse } = await renderComponent(<WorkspaceRoot orchestrator={orchestrator} />, {
    width: 120,
    height: 40,
    providers: { kv: true, focus: true, dialog: true, notifications: true },
  })
  const before = await waitForFrameText(frame, "Fix the flaky login · running")
  const lines = before.split("\n")
  const header = lines.findIndex((line) => /^\s*repo\b/.test(line))
  await mockMouse.click(
    3,
    lines.findIndex((line) => line.includes("New task")),
  )
  await waitForFrameText(frame, "No folder")
  // The header's + shows under the pointer.
  await mockMouse.moveTo(4, header)
  const hovered = await waitForFrameText(frame, "repo v")
  const plus = hovered.split("\n")[header]?.indexOf("+") ?? -1
  expect(plus).toBeGreaterThan(0)
  await mockMouse.click(plus, header)
  const moved = await waitForFrameText(frame, "Describe a task")
  expect(moved).not.toContain("No folder")
})
