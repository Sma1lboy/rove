/** @jsxImportSource @opentui/react */
/**
 * One Workspace Host region throwing during render must not take its
 * siblings down, and the region must come back once its input changes or
 * the user clicks retry.
 */

import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { useState } from "react"
import { PaneErrorBoundary } from "../../src/tui-react/lib/pane-error-boundary"
import { act, renderComponent } from "./harness"

let previousHome: string | undefined
let restoreConsole: () => void = () => {}

beforeEach(() => {
  previousHome = process.env.ROVE_HOME_DIR
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-region-crash-"))
  // React reports caught render failures to console.error; these are expected.
  const spy = spyOn(console, "error").mockImplementation(() => {})
  restoreConsole = () => spy.mockRestore()
})

afterEach(() => {
  restoreConsole()
  if (previousHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = previousHome
})

let broken = true
let selectTask: (id: string) => void = () => {}

function FileTreeProbe(props: { task: string }) {
  if (broken) throw new Error("files-probe")
  return <text>{`files of ${props.task}`}</text>
}

function Host() {
  const [task, setTask] = useState("task-a")
  selectTask = setTask
  return (
    <box flexDirection="row">
      <box width={20}>
        <PaneErrorBoundary region="sidebar">
          <text>task list ok</text>
        </PaneErrorBoundary>
      </box>
      <box flexGrow={1}>
        <PaneErrorBoundary region="files" resetKeys={[task]}>
          <FileTreeProbe task={task} />
        </PaneErrorBoundary>
      </box>
    </box>
  )
}

test("a crashed region names itself, leaves its sibling live, and recovers on a new selection", async () => {
  broken = true
  const { frame } = await renderComponent(<Host />, { width: 90, height: 12 })
  const crashed = await frame()
  expect(crashed).toContain("task list ok")
  expect(crashed).toContain("The file tree hit an error")
  expect(crashed).not.toContain("This pane crashed")

  broken = false
  await act(async () => selectTask("task-b"))
  const recovered = await frame()
  expect(recovered).toContain("files of task-b")
  expect(recovered).toContain("task list ok")
})

test("clicking retry re-renders the region once the fault is gone", async () => {
  broken = true
  const { frame, mockMouse } = await renderComponent(<Host />, { width: 90, height: 12 })
  const lines = (await frame()).split("\n")
  const y = lines.findIndex((line) => line.includes("[ retry ]"))
  expect(y).toBeGreaterThanOrEqual(0)
  const x = (lines[y] as string).indexOf("[ retry ]") + 2

  broken = false
  await act(async () => {
    await mockMouse.click(x, y)
  })
  expect(await frame()).toContain("files of task-a")
})
