/**
 * Engine-DECLARED launch flags, proven with a NON-BUILT-IN engine.
 *
 * Both rules under test were data-driven at the gate and hardcoded at the
 * flag — `if (v === "codex")` for effort, `coerceVendorId(vendor) !== "claude"`
 * for the system prompt — so a declared level or protocol was accepted
 * everywhere and then dropped at launch, silently.
 *
 * Every case here uses an engine that is NOT literally named codex/claude:
 * a wrapper preset (`claudecpa`, declaring the claude protocol) and a fake
 * engine that declares `effortLevels` + `effortArgv`. Asserting on the
 * built-ins alone proves nothing — they were green while both bugs were live.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const registry = await vi.hoisted(async () => ({ effortArgv: undefined as unknown }))

vi.mock("../../src/engine/registry.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/engine/registry.ts")>()
  return {
    ...actual,
    engineEntry: (vendor: string) =>
      vendor === "fakeengine"
        ? {
            ...actual.engineEntry(vendor),
            effortLevels: ["low", "high"],
            effortArgv: (base: readonly string[], level: string) => [...base, "--reasoning", level],
          }
        : actual.engineEntry(vendor),
  }
})

const { withEngineEffort } = await import("../../src/engine/interactive-command.ts")
const { engineLaunchArgv } = await import("../../src/engine/engine-presets.ts")
const { withDispatcherProtocol, withWorktreeProtocol } = await import("../../src/engine/worktree-protocol.ts")

const on = () => true

let home: string
let originalHome: string | undefined

function writeState(state: Record<string, unknown>): void {
  const dir = join(home, ".config", "rove")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "state.json"), JSON.stringify(state), "utf8")
}

/** A real wrapper preset: its own id + command, declaring the claude protocol. */
function registerClaudeWrapper(): void {
  writeState({
    customEngineIds: ["claudecpa"],
    "engineCommand.claudecpa": "claudecpa --dangerously-skip-permissions",
    "engineProtocol.claudecpa": "claude",
  })
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kobe-declared-flags-"))
  originalHome = process.env.KOBE_HOME_DIR
  process.env.KOBE_HOME_DIR = home
  writeState({})
})

afterEach(() => {
  if (originalHome === undefined) {
    // biome-ignore lint/performance/noDelete: the var must be truly unset when it started unset.
    delete process.env.KOBE_HOME_DIR
  } else process.env.KOBE_HOME_DIR = originalHome
  rmSync(home, { recursive: true, force: true })
})

describe("declared effort reaches the launch argv", () => {
  it("applies a NON-CODEX engine's own effortArgv", () => {
    // The whole bug: this engine declares levels, so "high" passes the gate,
    // shows in the picker and rides /api/engines — and under the old
    // `if (v === "codex")` it was then dropped with no error.
    expect(withEngineEffort(["fake-cli"], "fakeengine", "high")).toEqual(["fake-cli", "--reasoning", "high"])
  })

  it("still drops a level the engine never declared", () => {
    expect(withEngineEffort(["fake-cli"], "fakeengine", "turbo")).toEqual(["fake-cli"])
  })

  it("drops a level for an engine that declares levels but no argv", () => {
    // Honest refusal, not a guess: nothing here knows how to spell it.
    expect(withEngineEffort(["copilot"], "copilot", "high")).toEqual(["copilot"])
  })

  it("carries effort through a WRAPPER preset that declares the codex protocol", () => {
    writeState({
      customEngineIds: ["mycodex"],
      "engineCommand.mycodex": "codex-wrapper --yolo",
      "engineProtocol.mycodex": "codex",
    })
    expect(engineLaunchArgv({ command: "mycodex", effort: "high" })).toContain("model_reasoning_effort=high")
  })
})

describe("system-prompt protocols reach a wrapper engine", () => {
  it("injects the worktree protocol into a claudecpa launch", () => {
    registerClaudeWrapper()
    const argv = withWorktreeProtocol(["claudecpa"], "claudecpa", "t1", { status: on, notes: on })
    // Without this, `experimental.autoStatus` never moves the card to
    // in_review on a wrapper engine — the exact silent gap the removed
    // `withClaudeSessionId` had.
    expect(argv).toContain("--append-system-prompt")
    expect(argv.join("\n")).toContain("api set-status --task-id t1 --status in_review")
  })

  it("injects the dispatcher protocol into a claudecpa main session", () => {
    registerClaudeWrapper()
    const argv = withDispatcherProtocol(["claudecpa"], "claudecpa", "m1", on)
    expect(argv).toContain("--append-system-prompt")
    expect(argv.join("\n")).toContain("DISPATCHER")
  })

  it("still refuses an engine whose protocol is not claude", () => {
    // A wrapper is not a blanket pass: kimi takes no --append-system-prompt,
    // and passing one would kill the launch.
    writeState({
      customEngineIds: ["mykimi"],
      "engineCommand.mykimi": "kimi-wrapper",
      "engineProtocol.mykimi": "kimi",
    })
    expect(withWorktreeProtocol(["mykimi"], "mykimi", "t1", { status: on, notes: on })).toEqual(["mykimi"])
  })

  it("still leaves a wrapper command that sets its own prompt flag alone", () => {
    registerClaudeWrapper()
    const own = ["claudecpa", "--append-system-prompt=mine"]
    expect(withWorktreeProtocol(own, "claudecpa", "t1", { status: on, notes: on })).toEqual(own)
  })
})
