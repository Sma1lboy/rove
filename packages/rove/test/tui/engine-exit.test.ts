import type { TabStatus } from "@sma1lboy/rove-daemon/daemon/row-status"
import { describe, expect, it } from "vitest"
import { engineExitOf } from "../../src/tui/workspace/engine-exit"
import type { TerminalTab } from "../../src/tui/workspace/terminal-tabs-core"

const engineTab = { id: "tab-1", kind: "engine" } as unknown as TerminalTab
const shellTab = { id: "tab-2", kind: "command" } as unknown as TerminalTab

const status = (over: Partial<TabStatus>): TabStatus => ({
  kind: "idle",
  since: 100,
  alive: true,
  restored: false,
  tracked: true,
  ...over,
})
const dead = status({ kind: "attention", reason: "dead", state: "dead" })

describe("engineExitOf", () => {
  it("reports a dead engine tab, with the daemon's recorded exit code", () => {
    const hook = { state: "dead", detail: { exit: { code: 127 } } } as const
    expect(engineExitOf(engineTab, dead, hook, undefined)).toEqual({ code: 127 })
  })

  it("reports no code when the daemon recorded none (killed by signal)", () => {
    const hook = { state: "dead", detail: { exit: { code: null, signal: "SIGTERM" } } } as const
    expect(engineExitOf(engineTab, dead, hook, undefined)).toEqual({ code: null })
    expect(engineExitOf(engineTab, dead, undefined, undefined)).toEqual({ code: null })
  })

  it.each([
    ["no status", undefined],
    ["idle", status({})],
    ["running", status({ kind: "running", state: "running" })],
    ["errored", status({ kind: "attention", reason: "error", state: "error" })],
    ["restored", status({ kind: "attention", reason: "restored" })],
  ])("stays silent without positive dead evidence (%s)", (_label, s) => {
    expect(engineExitOf(engineTab, s, undefined, undefined)).toBeNull()
  })

  it("never claims an engine exit on a shell tab", () => {
    expect(engineExitOf(shellTab, dead, undefined, undefined)).toBeNull()
  })

  it("is silent while the live probe sees an engine in the session, whatever the daemon last recorded", () => {
    expect(engineExitOf(engineTab, dead, undefined, undefined, true)).toBeNull()
  })

  it("hides the death the user already retried, but shows the next one", () => {
    expect(engineExitOf(engineTab, dead, undefined, dead.since)).toBeNull()
    expect(engineExitOf(engineTab, { ...dead, since: dead.since + 5 }, undefined, dead.since)).toEqual({ code: null })
  })
})
