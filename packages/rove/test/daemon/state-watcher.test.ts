/**
 * The `state` channel is how a write from any process (a CLI verb, another
 * TUI, the bridge) reaches every client live. Writes go through the real
 * store (`patchStateFile`, tmp + rename), as in production.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DaemonEventBus } from "@sma1lboy/rove-daemon/daemon/event-bus"
import { startStateWatcher } from "@sma1lboy/rove-daemon/daemon/state-watcher"
import { defaultUiPrefsStatePath } from "@sma1lboy/rove-daemon/daemon/ui-prefs-watcher"
import { afterEach, beforeEach, expect, test } from "vitest"
import { patchStateFile } from "../../src/state/store.ts"

let home: string
let savedHome: string | undefined
let stop: (() => void) | null = null
let pushes: Array<Record<string, unknown>>
let bus: DaemonEventBus

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "rove-state-watch-"))
  savedHome = process.env.ROVE_HOME_DIR
  process.env.ROVE_HOME_DIR = home
  bus = new DaemonEventBus()
  pushes = []
  bus.onPublish((event) => {
    if (event.channel === "state") pushes.push((event.payload as { state: Record<string, unknown> }).state)
  })
})

afterEach(() => {
  stop?.()
  if (savedHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = savedHome
  fs.rmSync(home, { recursive: true, force: true })
})

async function waitFor(cond: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000
  while (!cond() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20))
  expect(cond()).toBe(true)
}

test("another process's write reaches subscribers without the unpublished keys, and a no-op write publishes nothing", async () => {
  patchStateFile({ savedRepos: ["/a"], "terminalTabs.t1": { tabs: [] }, "lastActive.taskId": "t1" })
  stop = startStateWatcher(bus, defaultUiPrefsStatePath(home), 25)
  expect(pushes).toEqual([{ savedRepos: ["/a"] }])

  patchStateFile({ savedRepos: ["/a", "/b"], machines: { box: { host: "box" } } })
  await waitFor(() => pushes.length === 2)
  expect(pushes[1]).toEqual({ savedRepos: ["/a", "/b"], machines: { box: { host: "box" } } })

  // A task switch writes these; no client reads them live.
  patchStateFile({ "terminalTabs.t1": { tabs: [{ id: "tab-1" }] }, "lastActive.taskId": "t2" })
  await new Promise((r) => setTimeout(r, 600))
  expect(pushes).toHaveLength(2)
})
