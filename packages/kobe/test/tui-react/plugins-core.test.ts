/**
 * Settings → Plugins view model (settings-dialog/plugins-core.ts).
 *
 * The section renders whatever these pure builders say, so the parts that
 * can silently go wrong are pinned here: a run log whose last line is
 * half-written (the daemon appends while we read), a manifest that no
 * longer parses, and the counts/source label shown per row.
 */

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginRegistryEntry } from "@sma1lboy/kobe-daemon/plugins/registry"
import { savePluginRegistry } from "@sma1lboy/kobe-daemon/plugins/registry"
import { afterEach, describe, expect, it } from "vitest"

const NONE: ReadonlySet<string> = new Set()
import { clearPluginEngines, pluginEngineIds } from "../../src/engine/contrib-engines.ts"
import {
  parseLastRun,
  pluginRowView,
  setPluginEnabled,
} from "../../src/tui-react/component/settings-dialog/plugins-core.ts"

const NOW = Date.parse("2026-07-27T12:00:00.000Z")

const githubEntry: PluginRegistryEntry = {
  id: "example.notify",
  source: { kind: "github", spec: "acme/kobe-notify" },
  root: "/home/u/.kobe/plugins/example.notify/checkout",
  enabled: true,
  version: "0.1.0",
  installedAt: NOW,
}

const MANIFEST = `
id = "example.notify"
name = "Notify"
version = "0.1.0"
min_kobe_version = "0.8.23"

[[actions]]
id = "test"
title = "Send a test notification"
command = ["sh", "notify.sh", "test"]

[[events]]
on = "agent.turn-complete"
command = ["sh", "notify.sh"]

[[events]]
on = "task.created"
command = ["sh", "notify.sh"]

[[settings]]
key = "KOBE_NOTIFY_SOUND"
label = "Sound"
type = "enum"
options = ["ping", "glass"]
default = "ping"
`

const runLine = (record: Record<string, unknown>) => `${JSON.stringify(record)}\n`

const ENGINE_ONLY_MANIFEST = `
id = "example.engine"
name = "Engine"
version = "0.1.0"
min_rove_version = "0.8.23"

[[engines]]
id = "aider"
name = "Aider"
command = ["aider"]
`

const PANE_ONLY_MANIFEST = `
id = "example.pane"
name = "Pane"
version = "0.1.0"
min_rove_version = "0.8.23"

[[panes]]
id = "board"
title = "Board"
command = ["sh", "board.sh"]
`

describe("parseLastRun", () => {
  it("returns the newest record, with ok only for a clean exit", () => {
    const text =
      runLine({ at: NOW - 1000, kind: "startup", label: "startup", exitCode: 0, durationMs: 5 }) +
      runLine({ at: NOW - 100, kind: "event", label: "agent.turn-complete", exitCode: 2, durationMs: 7 })
    expect(parseLastRun(text)).toEqual({
      at: NOW - 100,
      label: "agent.turn-complete",
      exitCode: 2,
      ok: false,
      running: false,
    })
  })

  it("reports a still-running hook as running, not as a failed exit", () => {
    const text =
      runLine({ at: NOW - 1000, kind: "event", label: "tool.post", exitCode: 0, durationMs: 5 }) +
      runLine({ at: NOW - 100, kind: "event", label: "tool.post", phase: "running", timeoutMs: 30_000 })
    // A hang used to log nothing at all; now it logs before it finishes, and
    // the row must not read that in-flight record as `exit null`.
    expect(parseLastRun(text)).toMatchObject({ label: "tool.post", running: true, ok: false, exitCode: null })
  })

  it("marks a spawn failure as not-ok and keeps the message", () => {
    const run = parseLastRun(runLine({ at: NOW, kind: "event", label: "task.created", spawnError: "ENOENT sh" }))
    expect(run).toMatchObject({ ok: false, exitCode: null, spawnError: "ENOENT sh" })
  })

  it("skips a half-written trailing line and falls back to the last valid one", () => {
    const text = `${runLine({ at: NOW - 500, kind: "startup", label: "startup", exitCode: 0 })}{"at":17`
    expect(parseLastRun(text)?.label).toBe("startup")
  })

  it("is null for a missing or empty log", () => {
    expect(parseLastRun(null)).toBeNull()
    expect(parseLastRun("\n\n")).toBeNull()
  })
})

describe("pluginRowView", () => {
  it("counts what the manifest declares and labels a GitHub source", () => {
    const row = pluginRowView(NONE, githubEntry, MANIFEST, null)
    expect(row.updateAvailable).toBe(false)
    expect(pluginRowView(new Set(["example.notify"]), githubEntry, MANIFEST, null).updateAvailable).toBe(true)
    expect(row).toMatchObject({
      id: "example.notify",
      version: "0.1.0",
      enabled: true,
      linked: false,
      source: "acme/kobe-notify",
      declares: { actions: 1, events: 2, panes: 0 },
      lastRun: null,
    })
  })

  it("reports null declares when the manifest is missing or unparsable", () => {
    expect(pluginRowView(NONE, githubEntry, null, null).declares).toBeNull()
    expect(pluginRowView(NONE, githubEntry, "id = 42", null).declares).toBeNull()
  })

  it("joins declared settings with their stored values, and has none without a manifest", () => {
    const stored = pluginRowView(NONE, githubEntry, MANIFEST, null, { KOBE_NOTIFY_SOUND: "glass" })
    expect(stored.settings).toEqual([
      {
        key: "KOBE_NOTIFY_SOUND",
        label: "Sound",
        type: "enum",
        options: ["ping", "glass"],
        defaultValue: "ping",
        value: "glass",
        defaulted: false,
      },
    ])
    expect(pluginRowView(NONE, githubEntry, MANIFEST, null).settings[0]).toMatchObject({
      value: "ping",
      defaulted: true,
    })
    expect(pluginRowView(NONE, githubEntry, null, null).settings).toEqual([])
  })

  it("shows a linked plugin's working directory as its source", () => {
    const linked: PluginRegistryEntry = {
      ...githubEntry,
      source: { kind: "link" },
      root: "/work/my-plugin",
      enabled: false,
    }
    const row = pluginRowView(NONE, linked, MANIFEST, null)
    expect(row.linked).toBe(true)
    expect(row.source).toBe("/work/my-plugin")
    expect(row.enabled).toBe(false)
  })

  it("counts declared engines in the declares summary", () => {
    expect(pluginRowView(NONE, githubEntry, MANIFEST, null).declares).toMatchObject({ engines: 0 })
    expect(pluginRowView(NONE, githubEntry, ENGINE_ONLY_MANIFEST, null).declares).toMatchObject({
      actions: 0,
      events: 0,
      panes: 0,
      engines: 1,
    })
  })

  it("flags a manifest whose platforms exclude this machine", () => {
    // Host-aware so the assertion holds on any dev/CI platform.
    const token = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"
    const other = token === "macos" ? "linux" : "macos"
    const currentOnly = MANIFEST.replace('version = "0.1.0"', `version = "0.1.0"\nplatforms = ["${token}"]`)
    const otherOnly = MANIFEST.replace('version = "0.1.0"', `version = "0.1.0"\nplatforms = ["${other}"]`)
    expect(pluginRowView(NONE, githubEntry, currentOnly, null).platformOk).toBe(true)
    expect(pluginRowView(NONE, githubEntry, otherOnly, null).platformOk).toBe(false)
    // No declaration → portable → fine; unreadable manifest → no pile-on.
    expect(pluginRowView(NONE, githubEntry, MANIFEST, null).platformOk).toBe(true)
    expect(pluginRowView(NONE, githubEntry, null, null).platformOk).toBe(true)
  })

  it("distinguishes 'hooks declared, never matched' from 'quiet by design'", () => {
    // Actions/events/startup produce log records; panes/settings/engines don't.
    expect(pluginRowView(NONE, githubEntry, MANIFEST, null).hooksDeclared).toBe(true)
    expect(pluginRowView(NONE, githubEntry, ENGINE_ONLY_MANIFEST, null).hooksDeclared).toBe(false)
    expect(pluginRowView(NONE, githubEntry, PANE_ONLY_MANIFEST, null).hooksDeclared).toBe(false)
    expect(pluginRowView(NONE, githubEntry, null, null).hooksDeclared).toBe(false)
  })
})

describe("setPluginEnabled", () => {
  afterEach(() => clearPluginEngines())

  it("re-reads plugin engines so a Settings toggle is live without a restart", () => {
    const root = mkdtempSync(join(tmpdir(), "rove-pc-plugin-"))
    writeFileSync(join(root, "rove-plugin.toml"), ENGINE_ONLY_MANIFEST)
    const home = mkdtempSync(join(tmpdir(), "rove-pc-home-"))
    savePluginRegistry(
      {
        plugins: [
          { id: "example.engine", source: { kind: "link" }, root, enabled: true, version: "0.1.0", installedAt: 0 },
        ],
      },
      home,
    )
    // Disabling drops the engine from the running process's table…
    setPluginEnabled("example.engine", false, home)
    expect(pluginEngineIds()).toEqual([])
    // …and re-enabling brings it back — both without a restart.
    setPluginEnabled("example.engine", true, home)
    expect(pluginEngineIds()).toEqual(["aider"])
  })
})
