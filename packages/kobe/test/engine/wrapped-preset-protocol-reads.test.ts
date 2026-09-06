/**
 * The five "how do we talk to this engine" reads, on a task whose `vendor` is
 * a RAW preset id.
 *
 * That shape is not hypothetical: the TUI's new-task dialog passes the picked
 * engine id straight through as `vendor` with no `command`
 * (`tui/lib/task-create-flow.ts`), and the change-engine picker offers every
 * `customEngineIds` entry (`engine/account-detect.ts` →
 * `engine-picker-dialog.tsx`). So a `claudecpa` preset declaring
 * `engineProtocol.claudecpa = "claude"` reaches the daemon as
 * `vendor: "claudecpa"`, and every read below used to key off that id — which
 * `engineEntry` answers with the documented EMPTY custom entry.
 *
 * Each assertion pairs the preset with plain `claude`: the preset must resolve
 * to the SAME adapter, which is the whole promise `engineProtocol.<id>` makes.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resolveComposerManifest } from "../../src/cli/api/pty-delivery.ts"
import { protocolEntry, sessionProtocol } from "../../src/engine/engine-presets.ts"
import { engineEntry } from "../../src/engine/registry.ts"

let home: string
let originalHome: string | undefined

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kobe-wrapped-preset-"))
  originalHome = process.env.KOBE_HOME_DIR
  process.env.KOBE_HOME_DIR = home
  const dir = join(home, ".config", "rove")
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "state.json"),
    JSON.stringify({
      customEngineIds: ["claudecpa"],
      "engineCommand.claudecpa": "claude",
      "engineProtocol.claudecpa": "claude",
    }),
    "utf8",
  )
})

afterEach(() => {
  if (originalHome === undefined) {
    // biome-ignore lint/performance/noDelete: the var must be truly unset when it started unset.
    delete process.env.KOBE_HOME_DIR
  } else process.env.KOBE_HOME_DIR = originalHome
  rmSync(home, { recursive: true, force: true })
})

describe("a wrapped preset resolves the protocol's adapter, not the empty custom entry", () => {
  it("has an empty entry under its own id — the trap every read below fell into", () => {
    const raw = engineEntry("claudecpa")
    expect(raw.builtin).toBe(false)
    expect(raw.history.readUsageSnapshot).toBeUndefined()
    expect(raw.screenManifest).toBeUndefined()
    expect(raw.terminalTitle).toBeUndefined()
    expect(raw.readTurns).toBeUndefined()
  })

  it("reads context/token usage through claude's history reader", () => {
    expect(protocolEntry("claudecpa").history.readUsageSnapshot).toBe(engineEntry("claude").history.readUsageSnapshot)
  })

  it("reads per-turn telemetry through claude's turn reader", () => {
    expect(protocolEntry("claudecpa").readTurns).toBe(engineEntry("claude").readTurns)
  })

  it("classifies the composer with claude's screen manifest", () => {
    expect(resolveComposerManifest("claudecpa")).toBe(engineEntry("claude").screenManifest)
    expect(resolveComposerManifest("claudecpa")).toBeDefined()
  })

  it("reads the OSC title turn hint with claude's title rules", () => {
    expect(protocolEntry("claudecpa").terminalTitle).toBe(engineEntry("claude").terminalTitle)
  })

  it("resolves claude's turn detector and session identity", () => {
    expect(sessionProtocol("claudecpa")).toBe("claude")
    expect(protocolEntry("claudecpa").sessionIdentity).toBe(engineEntry("claude").sessionIdentity)
  })

  it("leaves an unregistered id generic rather than guessing claude", () => {
    expect(sessionProtocol("mystery-engine")).toBe("mystery-engine")
    expect(resolveComposerManifest("mystery-engine")).toBeUndefined()
  })
})

/**
 * The same rule at the seam that actually consumes it. `registry.ts` is
 * deliberately state-free (vitest and the daemon both import it), so it cannot
 * resolve a preset itself — which is why the wiring, not the registry, is where
 * these four reads have to be protocol-keyed.
 */
describe("daemonRuntime keys its engine reads on the protocol", () => {
  it("reads the OSC title turn hint claude's glyphs imply", async () => {
    const { daemonRuntime } = await import("../../src/core/daemon-runtime.ts")
    const working = "⠹ Claude"
    expect(daemonRuntime.titleTurnHint("claudecpa", working)).toBe(daemonRuntime.titleTurnHint("claude", working))
    expect(daemonRuntime.titleTurnHint("claudecpa", working)).not.toBeNull()
  })

  it("builds claude's turn detector for a wrapped preset", async () => {
    const { daemonRuntime } = await import("../../src/core/daemon-runtime.ts")
    expect(daemonRuntime.createEngineTurnDetector("claudecpa").constructor).toBe(
      daemonRuntime.createEngineTurnDetector("claude").constructor,
    )
  })
})
