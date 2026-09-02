/** @jsxImportSource @opentui/react */
/**
 * A pane crash must leave enough evidence to identify the React owner and
 * the state edge that preceded it. Production bundles minify function names,
 * so Error.stack alone reduces React #185 to renderer internals.
 */

import { afterEach, expect, spyOn, test } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { flushClientLog, setClientLogContext } from "@sma1lboy/kobe-daemon/client/client-log"
import { defaultClientLogPath } from "@sma1lboy/kobe-daemon/daemon/paths"
import { clearRecentStateChangesForTest, createStateCell } from "../../src/lib/external-store"
import { PaneErrorBoundary } from "../../src/tui-react/lib/host-boot"
import { renderComponent } from "./harness"

let previousHome: string | undefined

afterEach(() => {
  if (previousHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = previousHome
  previousHome = undefined
  setClientLogContext("client")
  clearRecentStateChangesForTest()
})

function CrashingWorkspaceLeaf(): never {
  throw new Error("diagnostic-probe")
}

test("pane-crash logs the component stack and recent named state changes", async () => {
  previousHome = process.env.ROVE_HOME_DIR
  const home = mkdtempSync(join(tmpdir(), "rove-pane-crash-"))
  process.env.ROVE_HOME_DIR = home
  setClientLogContext("pane-diagnostic-test")
  clearRecentStateChangesForTest()

  const tasks = createStateCell<readonly string[]>([], "orchestrator.tasks")
  tasks.set(["task-a", "task-b"])

  // React deliberately reports caught render failures to console.error.
  // Keep this probe's expected crash from polluting the render-suite output.
  const consoleError = spyOn(console, "error").mockImplementation(() => {})
  try {
    const { frame } = await renderComponent(
      <PaneErrorBoundary>
        <CrashingWorkspaceLeaf />
      </PaneErrorBoundary>,
    )
    expect(await frame()).toContain("This pane crashed")

    await flushClientLog()
    const log = readFileSync(defaultClientLogPath(home), "utf8")
    expect(log).toContain("[pane-crash]")
    expect(log).toContain("diagnostic-probe")
    expect(log).toContain("React component stack:")
    expect(log).toContain("CrashingWorkspaceLeaf")
    expect(log).toContain("Recent state changes:")
    expect(log).toContain("orchestrator.tasks: Array(0) -> Array(2)")
    expect(log).not.toContain("task-a")
    expect(log).not.toContain("task-b")
  } finally {
    consoleError.mockRestore()
  }
})
