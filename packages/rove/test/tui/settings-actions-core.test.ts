import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@sma1lboy/rove-client/client/remote-orchestrator.ts", () => ({
  RemoteOrchestrator: class MockRemoteOrchestrator {},
}))

import { RemoteOrchestrator } from "@sma1lboy/rove-client/client/remote-orchestrator.ts"
import { hasRestartableDaemon, removeTasksFileForReset } from "../../src/tui/component/settings-dialog/actions-core.ts"

let home: string
let originalRoveHome: string | undefined

beforeEach(() => {
  originalRoveHome = process.env.ROVE_HOME_DIR
  home = mkdtempSync(join(tmpdir(), "rove-settings-actions-"))
  process.env.ROVE_HOME_DIR = home
})

afterEach(() => {
  if (originalRoveHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = originalRoveHome
  rmSync(home, { recursive: true, force: true })
})

describe("settings action core", () => {
  it("recognizes only the daemon-backed orchestrator", () => {
    const Remote = RemoteOrchestrator as unknown as new () => object
    expect(hasRestartableDaemon(new Remote() as never)).toBe(true)
    expect(hasRestartableDaemon(undefined)).toBe(false)
    expect(hasRestartableDaemon({} as never)).toBe(false)
  })

  it("removes only the canonical task index and tolerates an absent file", () => {
    const tasksPath = join(home, ".rove", "tasks.json")
    mkdirSync(join(home, ".rove"), { recursive: true })
    writeFileSync(tasksPath, "{}")
    removeTasksFileForReset()
    expect(existsSync(tasksPath)).toBe(false)
    expect(() => removeTasksFileForReset()).not.toThrow()
  })
})
