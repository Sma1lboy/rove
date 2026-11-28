/**
 * The engine's OSC title is one more title report: the newest report wins. Real Orchestrator +
 * on-disk store, rove's real `conversationTitle`; only the tab layout is a literal.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Orchestrator } from "@sma1lboy/rove-core/orchestrator/core.ts"
import { TaskIndexStore } from "@sma1lboy/rove-core/orchestrator/index/store.ts"
import { GitWorktreeManager } from "@sma1lboy/rove-core/orchestrator/worktree/manager.ts"
import { conversationTitle } from "@sma1lboy/rove-core/tabs/terminal-tab-split.ts"
import type { TerminalTab } from "@sma1lboy/rove-core/tabs/terminal-tabs-core.ts"
import { syncEngineTitle } from "@sma1lboy/rove-daemon/daemon/engine-title-sync"
import type { SharedTabs } from "@sma1lboy/rove-daemon/daemon/tabs-ops"
import { afterEach, beforeEach, expect, test } from "vitest"

let tmpRoot: string
let store: TaskIndexStore
let orch: Orchestrator

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rove-enginetitle-"))
  store = new TaskIndexStore({ homeDir: path.join(tmpRoot, "home") })
  await store.load()
  orch = new Orchestrator({ store, worktrees: new GitWorktreeManager() })
})

afterEach(() => fs.rmSync(tmpRoot, { recursive: true, force: true }))

const TABS: SharedTabs = {
  nextOrdinal: 3,
  tabs: [
    { id: "tab-1", ordinal: 1, kind: "engine", vendor: "claude" },
    { id: "tab-2", ordinal: 2, kind: "command", command: "zsh" },
  ],
}

const deps = () => ({
  orch,
  tabsOf: () => TABS,
  conversationTitle: (tab: SharedTabs["tabs"][number], vendor: string, raw: string) =>
    conversationTitle(tab as unknown as TerminalTab, vendor, raw),
  defaultVendor: "claude",
})

test("the newest report wins: engine title, then a rename, then a NEW engine title", async () => {
  const { id } = await orch.openDirectoryTask({ dir: tmpRoot, title: "first words of the prompt" })
  await syncEngineTitle(deps(), id, "tab-1", "✳ Fix the login bug")
  expect(orch.getTask(id)?.title).toBe("Fix the login bug")

  await orch.setTitle(id, "my own name")
  // The same report again (every tick, every daemon restart) is not news.
  await syncEngineTitle(deps(), id, "tab-1", "✳ Fix the login bug")
  expect(orch.getTask(id)?.title).toBe("my own name")

  await syncEngineTitle(deps(), id, "tab-1", "✳ Ship the release")
  expect(orch.getTask(id)?.title).toBe("Ship the release")
})

test("only the conversation's tab names the task, and a product-name title is no name", async () => {
  const { id } = await orch.openDirectoryTask({ dir: tmpRoot, title: "first words of the prompt" })
  await syncEngineTitle(deps(), id, "tab-2", "vim notes.md")
  await syncEngineTitle(deps(), id, "tab-1", "Claude Code")
  expect(orch.getTask(id)?.title).toBe("first words of the prompt")
})
