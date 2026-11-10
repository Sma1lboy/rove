/**
 * Viewport tabs (`EngineTab.ptyTask`) + the daemon's tab store — the kanban
 * `projectWorktree` / `project` placement mechanics.
 *
 * Why these matter: a viewport tab presents another task's session inside
 * the PROJECT workspace. If its PTY key, cwd, or launch identity drift from
 * the referenced task, the project strip would spawn a SECOND session on
 * the story's worktree (duplicate engines, orphaned PTYs) instead of
 * attaching to the one the kanban start launched — and the daemon append is
 * what makes a non-mounted workspace render the new tab at all. The daemon
 * mints the appended tab's id, so no other client can be minting the same one.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { SharedTabs } from "@sma1lboy/rove-daemon/daemon/tabs-ops"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resetTabsSyncForTests } from "../../src/tui-react/workspace/tabs-sync.ts"
import { appendBackgroundEngineTab, tabsByTask } from "../../src/tui-react/workspace/terminal-tabs-shared.ts"
import { buildIssueTabSpawn } from "../../src/tui/workspace/issue-chat-spawn.ts"
import { type EngineTab, initialTabs, tabCwdFor, tabPtyKeyFor } from "../../src/tui/workspace/terminal-tabs-core.ts"
import { type TabsSyncDaemon, attachTabsDaemon } from "../tui-react/tabs-sync-daemon.ts"

let tmpHome: string
let originalHome: string | undefined
let daemon: TabsSyncDaemon | null = null

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "rove-viewport-"))
  originalHome = process.env.ROVE_HOME_DIR
  process.env.ROVE_HOME_DIR = tmpHome
  resetTabsSyncForTests()
})

afterEach(() => {
  daemon?.detach()
  daemon = null
  if (originalHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = originalHome
  fs.rmSync(tmpHome, { recursive: true, force: true })
})

/** A daemon whose `main-task` already shows one tab (tab-1), attached and loaded. */
async function withDaemon(): Promise<TabsSyncDaemon> {
  const strip: SharedTabs = {
    tabs: [{ kind: "engine", id: "tab-1", title: null, ordinal: 1 }],
    activeId: "tab-1",
    nextOrdinal: 2,
  }
  daemon = await attachTabsDaemon({ "main-task": strip })
  return daemon
}

const viewport: EngineTab = {
  kind: "engine",
  id: "tab-3",
  title: null,
  ordinal: 3,
  vendor: "claude",
  sessionId: "sess-child",
  spawned: true,
  ptyTask: { id: "child-task", worktree: "/wt/child" },
}

describe("viewport tab key/cwd", () => {
  it("attaches to the referenced task's FIRST session and runs in its worktree", () => {
    expect(tabPtyKeyFor("main-task", viewport)).toBe("child-task::tab-1")
    expect(tabCwdFor(viewport, "/repo/main")).toBe("/wt/child")
    // Ordinary tabs stay keyed under their own task.
    const plain = initialTabs().tabs[0]
    expect(tabPtyKeyFor("main-task", plain)).toBe("main-task::tab-1")
    expect(tabCwdFor(plain, "/repo/main")).toBe("/repo/main")
  })
})

describe("appendBackgroundEngineTab", () => {
  it("appends after the existing strip under an id the daemon mints, keeping the given sessionId", async () => {
    const { store, tabs } = await withDaemon()
    // Another client holds tab-2 and tab-3 from the daemon's counter.
    store.reserve("main-task", 2)
    const tab = await appendBackgroundEngineTab("main-task", {
      vendor: "claude",
      sessionId: "sess-child",
      ptyTask: { id: "child-task", worktree: "/wt/child" },
    })
    expect(tab).toEqual({
      kind: "engine",
      id: "tab-4",
      ordinal: 4,
      title: null,
      vendor: "claude",
      sessionId: "sess-child",
      spawned: true,
      ptyTask: { id: "child-task", worktree: "/wt/child" },
    })
    // The daemon holds it after the existing strip, and the view shows the daemon's tabs.
    expect(tabs("main-task")?.tabs.map((t) => t.id)).toEqual(["tab-1", "tab-4"])
    expect(tabsByTask.get("main-task")?.tabs.map((t) => t.id)).toEqual(["tab-1", "tab-4"])
  })

  it("pins a fresh session id when none is given (the project-checkout chattab)", async () => {
    const { tabs } = await withDaemon()
    const tab = await appendBackgroundEngineTab("main-task", { vendor: "claude" })
    expect(tab?.id).toBe("tab-2")
    expect(tab?.sessionId).toBeTruthy()
    expect(tab?.ptyTask).toBeUndefined()
    expect(tabs("main-task")?.tabs.find((t) => t.id === "tab-2")).toMatchObject({ sessionId: tab?.sessionId })
  })

  it("answers null with no daemon attached — nothing to mint the id", async () => {
    expect(await appendBackgroundEngineTab("main-task", { vendor: "claude" })).toBeNull()
    expect(tabsByTask.has("main-task")).toBe(false)
  })
})

describe("buildIssueTabSpawn", () => {
  it("the story prompt rides the appended tab's spawn even though it is not the strip's first tab", async () => {
    await withDaemon()
    const tab = (await appendBackgroundEngineTab("main-task", { vendor: "claude" })) as EngineTab
    expect(tab.id).toBe("tab-2")
    const spawn = buildIssueTabSpawn({
      taskId: "main-task",
      repoRoot: "/repo/main",
      worktreePath: "/repo/main",
      tab,
      vendor: "claude",
      prompt: "Work on user story #9: do the thing",
      shell: "/bin/zsh",
    })
    expect(spawn.ptyKey).toBe(`main-task::${tab.id}`)
    expect(spawn.command[2]).toContain("Work on user story #9: do the thing")
    expect(spawn.command[2]).toContain(`--session-id ${tab.sessionId}`)
  })
})
