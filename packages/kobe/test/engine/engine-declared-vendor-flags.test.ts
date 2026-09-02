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

const trusted = vi.hoisted(() => ({ paths: [] as string[] }))

vi.mock("../../src/engine/registry.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/engine/registry.ts")>()
  return {
    ...actual,
    engineEntry: (vendor: string) => {
      const entry = actual.engineEntry(vendor)
      if (vendor === "fakeengine") {
        return {
          ...entry,
          effortLevels: ["low", "high"],
          effortArgv: (base: readonly string[], level: string) => [...base, "--reasoning", level],
        }
      }
      // Claude's real trustWorktree writes the user's ~/.claude.json (it
      // takes homedir() with no seam), so record the call instead.
      if (vendor === "claude") {
        return { ...entry, trustWorktree: (worktreePath: string) => trusted.paths.push(worktreePath) }
      }
      return entry
    },
  }
})

const { withEngineEffort } = await import("../../src/engine/interactive-command.ts")
const { engineLaunchArgv } = await import("../../src/engine/engine-presets.ts")
const { withDispatcherProtocol, withWorktreeProtocol } = await import("../../src/engine/worktree-protocol.ts")
const { trustEngineWorktree } = await import("../../src/engine/trust-worktree.ts")
const { buildEngineSessionLaunch } = await import("../../src/engine/session-launch.ts")
const { latestTranscriptMtime } = await import("../../src/monitor/activity.ts")
const { encodeCwd } = await import("../../src/engine/claude-code-local/history.ts")

const on = () => true

let home: string
let originalHome: string | undefined
let originalClaudeConfigDir: string | undefined

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
  originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.KOBE_HOME_DIR = home
  // Claude's transcript reader honours this, so the history assertions read
  // fixtures under the temp home instead of the developer's ~/.claude.
  process.env.CLAUDE_CONFIG_DIR = join(home, ".claude")
  trusted.paths.length = 0
  writeState({})
})

afterEach(() => {
  if (originalHome === undefined) {
    // biome-ignore lint/performance/noDelete: the var must be truly unset when it started unset.
    delete process.env.KOBE_HOME_DIR
  } else process.env.KOBE_HOME_DIR = originalHome
  if (originalClaudeConfigDir === undefined) {
    // biome-ignore lint/performance/noDelete: the var must be truly unset when it started unset.
    delete process.env.CLAUDE_CONFIG_DIR
  } else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
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

/**
 * `docs/ENGINES.md` promises that setting `engineProtocol.<id>` makes "the
 * transcript reader, workspace-trust pre-answer, and first-message delivery
 * all apply". All three looked the entry up by the RAW preset id, which finds
 * the empty custom entry — so a wrapper got the trust dialog Rove is supposed
 * to pre-answer, read no history, and (on a kimi protocol) took its first
 * message on argv, where kimi reads it as an unknown subcommand and exits.
 */
describe("a declared protocol reaches trust, delivery and history", () => {
  /** A worktree with one claude transcript in the temp CLAUDE_CONFIG_DIR. */
  function seedClaudeTranscript(): string {
    const worktree = join(home, "wt")
    const dir = join(home, ".claude", "projects", encodeCwd(worktree))
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, "11111111-2222-3333-4444-555555555555.jsonl"),
      `${JSON.stringify({ type: "user", message: { role: "user", content: "hello" } })}\n`,
      "utf8",
    )
    return worktree
  }

  it("pre-answers the trust dialog through the wrapped engine's store", () => {
    registerClaudeWrapper()
    trustEngineWorktree("claudecpa", "/repo/.worktrees/t1")
    expect(trusted.paths).toEqual(["/repo/.worktrees/t1"])
  })

  it("still writes no trust entry for a preset that declares no protocol", () => {
    // A generic preset has no store to pre-answer — the honest answer is to
    // do nothing, not to guess claude's.
    writeState({ customEngineIds: ["plainshim"], "engineCommand.plainshim": "plain-shim" })
    trustEngineWorktree("plainshim", "/repo/.worktrees/t1")
    expect(trusted.paths).toEqual([])
  })

  it("pastes a kimi-protocol preset's first message instead of putting it on argv", () => {
    writeState({
      customEngineIds: ["mykimi"],
      "engineCommand.mykimi": "kimi-wrapper",
      "engineProtocol.mykimi": "kimi",
    })
    const launch = buildEngineSessionLaunch({
      task: { id: "t1", kind: "task", vendor: "mykimi", repo: "/repo" },
      worktreePath: "/repo/.worktrees/t1",
      shell: "/bin/zsh",
      argv: ["kimi-wrapper"],
      promptIntent: { kind: "explicit", prompt: "fix it" },
      protocolGates: { status: () => false, notes: () => false, dispatcher: () => false },
      readNotes: () => [],
    })
    expect(launch.firstMessage).toBe("fix it")
    expect(launch.command[2]).not.toContain("fix it")
  })

  it("reads the wrapped engine's transcripts", async () => {
    registerClaudeWrapper()
    expect(await latestTranscriptMtime("claudecpa", seedClaudeTranscript())).toBeGreaterThan(0)
  })

  it("still reads no transcripts for a preset that declares no protocol", async () => {
    const worktree = seedClaudeTranscript()
    writeState({ customEngineIds: ["plainshim"], "engineCommand.plainshim": "plain-shim" })
    expect(await latestTranscriptMtime("plainshim", worktree)).toBe(0)
  })
})
