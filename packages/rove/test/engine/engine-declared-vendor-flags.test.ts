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

import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@sma1lboy/rove-core/lib/invocation.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sma1lboy/rove-core/lib/invocation.ts")>()
  return { ...actual, roveCliInvocation: () => ["bun", ...actual.roveCliInvocation().slice(1)] }
})

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
          modelArgv: (base: readonly string[], model: string) => [...base, "--llm", model],
        }
      }
      return entry
    },
  }
})

const { withEngineEffort, withEngineModel } = await import("../../src/engine/interactive-command.ts")
const { setRepoInitOverride } = await import("@sma1lboy/rove-core/state/repos.ts")
const { engineLaunchArgv } = await import("../../src/engine/engine-presets.ts")
const { withWorktreeProtocol } = await import("../../src/engine/worktree-protocol.ts")
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
  home = mkdtempSync(join(tmpdir(), "rove-declared-flags-"))
  originalHome = process.env.ROVE_HOME_DIR
  originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.ROVE_HOME_DIR = home
  // Claude's transcript reader honours this, so the history assertions read
  // fixtures under the temp home instead of the developer's ~/.claude.
  process.env.CLAUDE_CONFIG_DIR = join(home, ".claude")
  writeState({})
})

afterEach(() => {
  if (originalHome === undefined) {
    // biome-ignore lint/performance/noDelete: the var must be truly unset when it started unset.
    delete process.env.ROVE_HOME_DIR
  } else process.env.ROVE_HOME_DIR = originalHome
  if (originalClaudeConfigDir === undefined) {
    // biome-ignore lint/performance/noDelete: the var must be truly unset when it started unset.
    delete process.env.CLAUDE_CONFIG_DIR
  } else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
  rmSync(home, { recursive: true, force: true })
})

describe("declared effort reaches the launch argv", () => {
  it("applies a NON-CODEX engine's own effortArgv", () => {
    // The whole bug: this engine declares levels, so "high" passes the gate,
    // shows in the picker and rides /api/engines — and an `if (v === "codex")`
    // argv branch would then drop it with no error.
    expect(withEngineEffort(["fake-cli"], "fakeengine", "high")).toEqual(["fake-cli", "--reasoning", "high"])
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

describe("declared model reaches the launch argv", () => {
  it("applies a NON-BUILT-IN engine's own modelArgv, verbatim", () => {
    expect(withEngineModel(["fake-cli"], "fakeengine", "x/y-2")).toEqual(["fake-cli", "--llm", "x/y-2"])
  })

  it("carries a model through a WRAPPER preset that declares the claude protocol", () => {
    registerClaudeWrapper()
    expect(engineLaunchArgv({ command: "claudecpa", model: "sonnet" })).toEqual([
      "claudecpa",
      "--dangerously-skip-permissions",
      "--model",
      "sonnet",
    ])
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
    expect(argv.join("\n")).toContain("api update --task-id t1 --status in_review")
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

  const launchTrustFixture = (vendor: string, kind: "task" | "dir") => {
    const checkout = join(home, "checkout")
    const alias = join(home, "linked checkout")
    mkdirSync(checkout)
    symlinkSync(checkout, alias, "junction")
    setRepoInitOverride(alias, { initScript: 'export CLAUDE_CONFIG_DIR="$PWD/profile"' })
    const launch = buildEngineSessionLaunch({
      task: { id: "probe", kind, repo: alias, vendor },
      argv: ["true"],
      shell: "/bin/sh",
      worktreePath: alias,
      promptIntent: { kind: "none" },
    })
    execFileSync("sh", ["-c", launch.command[2] ?? ""], {
      cwd: alias,
      stdio: "ignore",
      env: { ...process.env, HOME: home, SHELL: "true" },
    })
    expect(existsSync(join(home, ".claude", ".claude.json"))).toBe(false)
    return join(checkout, "profile", ".claude.json")
  }

  it("trusts the physical worktree in the wrapped engine's post-init profile", () => {
    registerClaudeWrapper()
    const file = launchTrustFixture("claudecpa", "task")
    expect(JSON.parse(readFileSync(file, "utf8")).projects).toEqual({
      [realpathSync(join(home, "checkout"))]: {
        hasTrustDialogAccepted: true,
        hasCompletedProjectOnboarding: true,
      },
    })
  })

  it.each([
    ["claude", "dir"],
    ["plainshim", "task"],
  ] as const)("leaves trust to the user for %s in a %s", (vendor, kind) => {
    writeState({ customEngineIds: ["plainshim"], "engineCommand.plainshim": "plain-shim" })
    expect(existsSync(launchTrustFixture(vendor, kind))).toBe(false)
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
