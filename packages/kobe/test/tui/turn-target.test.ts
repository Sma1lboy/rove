/**
 * `targetFor` — which engine a tab's turn detector tracks.
 *
 * The live probe (tri-state) outranks the tab's creation pin: the pin only
 * covers the spawn/attach window where the probe cannot answer (undefined).
 * Before this, an engine tab's pin won unconditionally, so a ctrl+C'd codex
 * tab stayed "codex" forever — wrong detector, wrong recorded identity,
 * wrong sidebar label (the screenshot bug: an idle tab wearing "codex 1"
 * while actually running claude).
 */

import { describe, expect, it } from "vitest"
import { foregroundEngineIn, parsePsSnapshot } from "../../src/engine/foreground"
import { engineEntry } from "../../src/engine/registry"
import type { TerminalTab } from "../../src/tui/workspace/terminal-tabs-core"
import { targetFor } from "../../src/tui/workspace/turn-target"

const engineTab = (over: Partial<TerminalTab> = {}): TerminalTab =>
  ({ kind: "engine", id: "tab-1", title: null, ordinal: 1, ...over }) as TerminalTab
const shellTab = (over: Partial<TerminalTab> = {}): TerminalTab =>
  ({ kind: "command", id: "tab-2", title: null, ordinal: 2, ...over }) as TerminalTab

describe("targetFor", () => {
  it("live engine wins — even over an engine tab's different pin", () => {
    const tab = engineTab({ vendor: "codex" })
    expect(targetFor("t", tab, "claude", () => "claude")).toEqual({ vendor: "claude", key: "t::tab-1" })
  })

  it("pin covers the spawn window (probe can't look yet)", () => {
    const tab = engineTab({ vendor: "codex" })
    expect(targetFor("t", tab, "claude", () => undefined)).toEqual({ vendor: "codex", key: "t::tab-1" })
    // unpinned engine tab inherits the task vendor
    expect(targetFor("t", engineTab(), "claude", () => undefined)).toEqual({ vendor: "claude", key: "t::tab-1" })
  })

  it("a confirmed bare shell detaches the detector — engine-born or not", () => {
    expect(targetFor("t", engineTab({ vendor: "codex" }), "claude", () => null)).toBeNull()
    expect(targetFor("t", shellTab(), "claude", () => null)).toBeNull()
  })

  it("a shell tab attaches only on a live engine", () => {
    expect(targetFor("t", shellTab(), "claude", () => "claude")).toEqual({ vendor: "claude", key: "t::tab-2" })
    expect(targetFor("t", shellTab(), "claude", () => undefined)).toBeNull()
  })
})

/**
 * The composed path the TUI actually runs: process walk → `targetFor` →
 * `engineEntry(...).screenManifest`. Contrib engines exist as a category
 * *because* they ship hand-tuned screen manifests, and nothing evaluated
 * them for a contrib task — the walk answered `null` (its id set was
 * built-ins only), so `targetFor` detached and `use-turn-polls` never
 * reached the manifest.
 */
describe("targetFor over the real foreground walk", () => {
  const rows = parsePsSnapshot(`
100 1 /bin/zsh -l
101 100 /usr/local/bin/opencode
200 1 /bin/zsh -l
`)
  const pids: Record<string, number> = { "t-oc::tab-1": 100, "t-oc::tab-2": 200 }
  const vendorOf = (key: string) => foregroundEngineIn(rows, pids[key] ?? 0)?.vendor ?? null

  it("attaches a detector to a live contrib engine, and reaches its screen manifest", () => {
    const target = targetFor("t-oc", engineTab({ vendor: "opencode" }), "opencode", vendorOf)
    expect(target).toEqual({ vendor: "opencode", key: "t-oc::tab-1" })
    expect(engineEntry(target?.vendor ?? "").screenManifest?.rules.length).toBeGreaterThan(0)
  })

  it("still detaches for a contrib tab whose engine really did quit", () => {
    const tab = engineTab({ id: "tab-2", vendor: "opencode" })
    expect(targetFor("t-oc", tab, "opencode", vendorOf)).toBeNull()
  })
})
