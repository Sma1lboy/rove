/**
 * `rove api tab-new --kind editor|pane|viewport` through the default runtime, against a faked PTY host.
 * What they pin: the caller never supplies a command, a file can't leave the worktree, and a launch
 * writes one row whose shape an attached TUI folds in (`purpose`, `ptyTask`, split leaf).
 */

import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { savePluginRegistry } from "@sma1lboy/rove-daemon/plugins/registry"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const host = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; payload: Record<string, unknown> }>,
  /** What the user's editor setting resolves to; null = none installed. The resolution itself is the TUI's (`editor-launch.test.ts`). */
  editor: true,
}))
vi.mock("../../src/tui/lib/editor-launch.ts", () => ({
  resolveEditorLaunch: async (_worktree: string, abs: string) =>
    host.editor ? { command: `cat '${abs}'`, label: abs.split("/").pop() } : null,
}))
vi.mock("../../src/engine/hosted-session.ts", async (original) => ({
  ...(await original<object>()),
  ensureHostedSessionHost: async () => ({
    rpc: {
      request: async (name: string, payload: Record<string, unknown> = {}) => {
        host.calls.push({ name, payload })
        if (name === "pty.list") return { sessions: [], admissionToken: "test" }
        if (name === "pty.open") return { replay: "", alive: true, created: true }
        return {}
      },
    },
    close() {},
  }),
}))

import { defaultApiRuntime } from "../../src/cli/api/runtime.ts"
import type { TabsState } from "../../src/tui/workspace/terminal-tabs-core.ts"

let home: string
let wt: string
const statePath = (): string => join(home, ".config/rove/state.json")
const saved = (taskId = "t"): TabsState => JSON.parse(readFileSync(statePath(), "utf8"))[`terminalTabs.${taskId}`]
const ENGINE = { kind: "engine", id: "tab-1", title: null, ordinal: 1 }
const seed = (state: Record<string, unknown>): void => writeFileSync(statePath(), JSON.stringify(state))
const opened = (): Array<Record<string, unknown>> =>
  host.calls.filter((c) => c.name === "pty.open").map((c) => c.payload)

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rove-api-tab-launch-"))
  wt = join(home, "wt")
  mkdirSync(wt)
  vi.stubEnv("ROVE_HOME_DIR", home)
  host.calls = []
  host.editor = true
  mkdirSync(join(home, ".config/rove"), { recursive: true })
  seed({
    "terminalTabs.t": { tabs: [ENGINE], activeId: "tab-1", nextOrdinal: 2 },
  })
})
afterEach(() => vi.unstubAllEnvs())

const editor = (file: string) => defaultApiRuntime.launchTab({ kind: "editor", taskId: "t", worktree: wt, file })

it("an editor tab runs the Settings editor on the file, in an editor-purpose command row", async () => {
  writeFileSync(join(wt, "a.txt"), "hi")
  const launched = await editor("a.txt")

  expect(launched.session).toBe("t::tab-2")
  expect(launched.replaces).toBeUndefined()
  const row = saved().tabs[1]
  expect(row).toMatchObject({ kind: "command", id: "tab-2", purpose: "editor", title: "a.txt" })
  const command = row?.kind === "command" ? row.command : []
  expect(command.slice(0, 2)).toEqual(["sh", "-c"])
  expect(command[2]).toMatch(/^cat .*a\.txt/)
  expect(opened()).toEqual([expect.objectContaining({ key: "t::tab-2", cwd: wt, command })])
})

it("a second file names the first editor tab as the one to close, after its own row exists", async () => {
  writeFileSync(join(wt, "a.txt"), "1")
  writeFileSync(join(wt, "b.txt"), "2")
  await editor("a.txt")
  const second = await editor("b.txt")

  expect(second.replaces).toBe("tab-2")
  expect(saved().tabs.map((t) => t.id)).toEqual(["tab-1", "tab-2", "tab-3"])
})

it("a file outside the worktree, a directory, a missing file or a missing editor is refused before anything runs", async () => {
  writeFileSync(join(home, "secret.txt"), "s")
  symlinkSync(join(home, "secret.txt"), join(wt, "link.txt"))
  mkdirSync(join(wt, "dir"))
  for (const [file, code] of [
    ["/etc/hosts", "BAD_FLAG"],
    ["../secret.txt", "BAD_FLAG"],
    ["link.txt", "BAD_FLAG"],
    ["dir", "BAD_FLAG"],
    ["nope.txt", "FILE_NOT_FOUND"],
  ] as const) {
    await expect(editor(file)).rejects.toMatchObject({ code })
  }
  writeFileSync(join(wt, "a.txt"), "hi")
  host.editor = false
  await expect(editor("a.txt")).rejects.toMatchObject({ code: "NO_EDITOR" })

  expect(opened()).toEqual([])
})

it("a viewport tab is a spawned engine row onto the other task's first session, and starts nothing", async () => {
  seed({
    "terminalTabs.t": { tabs: [ENGINE], activeId: "tab-1", nextOrdinal: 2 },
    "terminalTabs.c": {
      tabs: [{ ...ENGINE, vendor: "codex", sessionId: "sess-1" }],
      activeId: "tab-1",
      nextOrdinal: 2,
    },
  })
  const launched = await defaultApiRuntime.launchTab({
    kind: "viewport",
    taskId: "t",
    view: { id: "c", worktree: "/wt/c" },
  })

  expect(launched.session).toBe("c::tab-1")
  expect(saved().tabs[1]).toEqual({
    kind: "engine",
    id: "tab-2",
    title: null,
    ordinal: 2,
    vendor: "codex",
    sessionId: "sess-1",
    spawned: true,
    ptyTask: { id: "c", worktree: "/wt/c" },
  })
  expect(host.calls).toEqual([])
})

function installPane(placement: "split" | "tab"): void {
  const root = join(home, "plugin")
  mkdirSync(root)
  writeFileSync(
    join(root, "rove-plugin.toml"),
    `id = "p"\nname = "P"\nversion = "1.0.0"\nmin_rove_version = "0.1.0"\n[[panes]]\nid = "git"\ntitle = "lazygit"\nplacement = "${placement}"\ncommand = ["lazygit"]`,
  )
  mkdirSync(join(home, ".rove"), { recursive: true })
  savePluginRegistry(
    { plugins: [{ id: "p", source: { kind: "link" }, root, enabled: true, version: "1.0.0", installedAt: 1 }] },
    home,
  )
}
const pane = (name: string, hostTab?: string) =>
  defaultApiRuntime.launchTab({ kind: "pane", taskId: "t", worktree: wt, pane: name, hostTab })

it("a split pane joins the tab's split tree as a titled leaf running the plugin's argv", async () => {
  installPane("split")
  const launched = await pane("p.git", "tab-1")

  expect(launched.leaf).toBe("leaf-2")
  expect(launched.session).toBe("t::tab-1::leaf-2")
  expect(JSON.stringify(saved().tabs[0])).toContain("lazygit")
  expect(opened()).toEqual([expect.objectContaining({ key: "t::tab-1::leaf-2", cwd: wt })])
})

it("a tab pane opens its own command tab titled by the manifest; an unknown pane is refused", async () => {
  installPane("tab")
  const launched = await pane("p.git")

  expect(launched.session).toBe("t::tab-2")
  expect(saved().tabs[1]).toMatchObject({ kind: "command", title: "lazygit" })
  await expect(pane("p.nope")).rejects.toMatchObject({ code: "PANE_NOT_FOUND" })
})
