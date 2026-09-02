/**
 * First-run onboarding — the pure apply half. Matters because it edits the
 * user's REAL shell rc: the append must be idempotent (an onboarding re-run
 * or a `rove completions` marker already present must never stack duplicate
 * source lines), and fish must get an autoload file, not an rc edit.
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { OnboardingEnvReport } from "../../src/cli/env-checks.ts"
import { detectShell, installCompletions } from "../../src/cli/onboarding.ts"

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  getPersistedBool: vi.fn((_key: string) => false),
  setPersistedBool: vi.fn(),
  npxSkillsArgv: vi.fn(() => ["skills", "add", "stub"]),
  npxSkillsCommand: vi.fn(() => "npx skills add stub"),
  isNpxMissing: vi.fn(() => false),
  markSkillHintSeen: vi.fn(),
  runOnboardingWizard: vi.fn(),
  checkOnboardingEnv: vi.fn(),
  loadStateFile: vi.fn(() => ({}) as Record<string, unknown>),
}))

vi.mock("node:child_process", () => ({ spawnSync: mocks.spawnSync }))
vi.mock("../../src/state/store.ts", () => ({
  getPersistedBool: mocks.getPersistedBool,
  setPersistedBool: mocks.setPersistedBool,
  loadStateFile: mocks.loadStateFile,
}))
vi.mock("../../src/lib/skill-install.ts", () => ({
  npxSkillsArgv: mocks.npxSkillsArgv,
  npxSkillsCommand: mocks.npxSkillsCommand,
  isNpxMissing: mocks.isNpxMissing,
  markSkillHintSeen: mocks.markSkillHintSeen,
}))
// The real probes read this machine's PATH and credential files; the tests
// assert composition with the report, not the probing.
vi.mock("../../src/cli/env-checks.ts", () => ({
  checkOnboardingEnv: mocks.checkOnboardingEnv,
}))
vi.mock("../../src/tui-react/onboarding/host.tsx", () => ({
  runOnboardingWizard: mocks.runOnboardingWizard,
}))

// Dynamic import of tui/index.tsx only happens in maybeRunOnboarding's happy
// path AFTER runOnboardingWizard resolves. We stub it so the import itself does
// not pull React/opentui into the vitest node environment.
vi.mock("../../src/tui/index.tsx", () => ({ startTui: vi.fn() }))

function freshHome(): string {
  return mkdtempSync(join(tmpdir(), "kobe-onboarding-"))
}

/** A passing environment: git present, one usable engine. */
function readyEnv(): OnboardingEnvReport {
  return {
    git: { line: "git:      ✓ git version 2.39.5", found: true },
    engines: {
      lines: ["engines:", "  claude  ✓ /bin/claude — logged in (a@b.c)"],
      anyUsable: true,
    },
  }
}

/**
 * The audit's abandon scenario: git is fine (every machine that ran
 * install.sh has it), no engine is usable. git present is the point — a
 * fixture missing BOTH lets a readiness check that ignores engines entirely
 * still pass this test.
 */
function emptyEnv(): OnboardingEnvReport {
  return {
    git: { line: "git:      ✓ git version 2.39.5", found: true },
    engines: {
      lines: ["engines:", "  claude  ✗ not found on PATH", "  codex   ✗ not found on PATH"],
      anyUsable: false,
    },
  }
}

function setProduct(name: "rove" | "kobe"): void {
  if (name === "rove") process.env.ROVE_INVOKED_AS = "rove"
  else process.env.ROVE_INVOKED_AS = undefined
}

function stdoutLines(spy: MockInstance<typeof process.stdout.write>): string[] {
  return spy.mock.calls
    .map((call) => String(call[0]))
    .join("")
    .split("\n")
    .filter(Boolean)
}

describe("detectShell", () => {
  it("maps $SHELL basenames to the supported shells", () => {
    expect(detectShell({ SHELL: "/bin/zsh" })).toBe("zsh")
    expect(detectShell({ SHELL: "/opt/homebrew/bin/bash" })).toBe("bash")
    expect(detectShell({ SHELL: "/usr/local/bin/fish" })).toBe("fish")
  })

  it("unknown or missing $SHELL is null (the wizard skips the step)", () => {
    expect(detectShell({ SHELL: "/bin/tcsh" })).toBeNull()
    expect(detectShell({})).toBeNull()
  })
})

describe("installCompletions", () => {
  it("appends one guarded source line to a missing .zshrc", () => {
    const home = freshHome()
    const rc = installCompletions("zsh", home, "rove")
    expect(rc).toBe(join(home, ".zshrc"))
    const content = readFileSync(rc, "utf8")
    expect(content).toContain("source <(rove completions zsh)")
    expect(content).toContain("command -v rove")
  })

  it("is idempotent — a second run never stacks a duplicate line", () => {
    const home = freshHome()
    installCompletions("zsh", home, "rove")
    installCompletions("zsh", home, "rove")
    const content = readFileSync(join(home, ".zshrc"), "utf8")
    expect(content.match(/rove completions zsh/g)).toHaveLength(1)
  })

  it("preserves an existing rc and respects a hand-rolled rove completions block", () => {
    const home = freshHome()
    const rc = join(home, ".bashrc")
    writeFileSync(rc, "# mine\nsource ~/.bash_completion.d/rove # rove completions via fpath\n")
    installCompletions("bash", home, "rove")
    const content = readFileSync(rc, "utf8")
    expect(content).toContain("# mine")
    // The marker was already present → nothing appended.
    expect(content).not.toContain("source <(rove completions bash)")
  })

  it("fish gets an autoloaded completions file, no rc edit", () => {
    const home = freshHome()
    const path = installCompletions("fish", home, "rove")
    expect(path).toBe(join(home, ".config", "fish", "completions", "rove.fish"))
    expect(readFileSync(path, "utf8")).toBe("rove completions fish | source\n")
    expect(existsSync(join(home, ".config", "fish", "config.fish"))).toBe(false)
  })

  it("uses the active cli name (kobe) when no product is pinned", () => {
    const home = freshHome()
    const rc = installCompletions("zsh", home)
    const content = readFileSync(rc, "utf8")
    expect(content).toContain("source <(kobe completions zsh)")
    expect(content).toContain("command -v kobe")
  })
})

describe("applyOnboardingChoices", () => {
  let stdoutSpy: MockInstance<typeof process.stdout.write>

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    // vi.clearAllMocks() wipes the hoisted default return too, so restore the
    // "npx is present" baseline every test starts from.
    mocks.isNpxMissing.mockReturnValue(false)
  })

  afterEach(() => {
    stdoutSpy.mockRestore()
    vi.clearAllMocks()
    process.env.ROVE_INVOKED_AS = undefined
  })

  it("declines everything when shell is unknown", async () => {
    setProduct("kobe")
    const { applyOnboardingChoices } = await import("../../src/cli/onboarding.ts")
    applyOnboardingChoices({ completions: false, skill: false }, null, readyEnv())
    const lines = stdoutLines(stdoutSpy)
    expect(lines.some((l) => l.includes("kobe skill install"))).toBe(true)
    expect(lines.some((l) => l.includes("kobe completions --help"))).toBe(false)
    expect(lines.some((l) => l.includes("You're ready to go!"))).toBe(true)
  })

  it("prints the environment lines and the ready banner only when an engine is usable", async () => {
    setProduct("kobe")
    const { applyOnboardingChoices } = await import("../../src/cli/onboarding.ts")
    applyOnboardingChoices({ completions: false, skill: false }, null, readyEnv())
    const lines = stdoutLines(stdoutSpy)
    expect(lines.some((l) => l.includes("git:      ✓ git version 2.39.5"))).toBe(true)
    expect(lines.some((l) => l.includes("engines:"))).toBe(true)
    expect(lines.some((l) => l.includes("✓ /bin/claude"))).toBe(true)
    expect(lines.some((l) => l.includes("You're ready to go!"))).toBe(true)
  })

  it("never says ready on an engine-less machine — it names the gap and the fix", async () => {
    setProduct("kobe")
    const { applyOnboardingChoices } = await import("../../src/cli/onboarding.ts")
    applyOnboardingChoices({ completions: false, skill: false }, null, emptyEnv())
    const lines = stdoutLines(stdoutSpy)
    // The audit's abandon moment: "You're ready to go!" printed on a machine
    // with no engine, four minutes before the first `n` fails. It must not.
    expect(lines.some((l) => l.includes("You're ready to go!"))).toBe(false)
    expect(lines.some((l) => l.includes("Not ready yet:"))).toBe(true)
    // …and the remediation is doctor's own line, not a paraphrase.
    expect(lines.some((l) => l.includes("install an engine CLI (claude, codex, copilot, or kimi) and log in"))).toBe(
      true,
    )
  })

  it("keeps the banner honest when git is the only thing missing", async () => {
    setProduct("kobe")
    const { applyOnboardingChoices } = await import("../../src/cli/onboarding.ts")
    applyOnboardingChoices({ completions: false, skill: false }, null, {
      ...readyEnv(),
      git: { line: "git:      ✗ not found on PATH", found: false },
    })
    const lines = stdoutLines(stdoutSpy)
    expect(lines.some((l) => l.includes("You're ready to go!"))).toBe(false)
    expect(lines.some((l) => l.includes("install git with your OS package manager"))).toBe(true)
  })

  it("installs completions and the skill when both chosen (kobe)", async () => {
    setProduct("kobe")
    mocks.spawnSync.mockReturnValue({ status: 0 })
    const { applyOnboardingChoices } = await import("../../src/cli/onboarding.ts")
    applyOnboardingChoices({ completions: true, skill: true }, "zsh", readyEnv())
    const lines = stdoutLines(stdoutSpy)
    expect(lines.some((l) => l.includes("completions hooked into"))).toBe(true)
    expect(lines.some((l) => l.includes("installing the Rove agent skill"))).toBe(true)
    expect(mocks.spawnSync).toHaveBeenCalledWith("npx", ["skills", "add", "stub"], { stdio: "inherit" })
  })

  it("uses the rove CLI name when invoked as rove", async () => {
    setProduct("rove")
    const { applyOnboardingChoices } = await import("../../src/cli/onboarding.ts")
    applyOnboardingChoices({ completions: false, skill: false }, "bash", readyEnv())
    const lines = stdoutLines(stdoutSpy)
    expect(lines.some((l) => l.includes("rove completions --help"))).toBe(true)
    expect(lines.some((l) => l.includes("rove skill install"))).toBe(true)
  })

  // The package ships BOTH bins, and the final "Run `…` to launch the TUI"
  // line is the easiest one to leave un-interpolated — which sends a `kobe`
  // user to a command they never installed under that name. Asserting the
  // kobe direction is the point: a rove-only check passes on a hardcoded
  // literal.
  it("tells a kobe user to run kobe, not rove", async () => {
    setProduct("kobe")
    const { applyOnboardingChoices } = await import("../../src/cli/onboarding.ts")
    applyOnboardingChoices({ completions: false, skill: false }, "bash", readyEnv())
    const lines = stdoutLines(stdoutSpy)
    const readyLine = lines.find((l) => l.includes("launch the TUI"))
    expect(readyLine).toBeDefined()
    expect(readyLine).toContain("kobe")
    expect(readyLine).not.toContain("rove")
  })

  // Declining the skill in the wizard must silence the one-time startup hint:
  // the user answered this question seconds ago, and the hint is the same
  // question again on stderr at the next launch.
  it("marks the skill hint seen when the user declines in the wizard", async () => {
    setProduct("rove")
    const { applyOnboardingChoices } = await import("../../src/cli/onboarding.ts")
    applyOnboardingChoices({ completions: false, skill: false }, "bash", readyEnv())
    expect(mocks.markSkillHintSeen).toHaveBeenCalled()
  })

  it("does not mark the hint seen when the user accepts the skill", async () => {
    setProduct("rove")
    mocks.spawnSync.mockReturnValue({ status: 0 })
    const { applyOnboardingChoices } = await import("../../src/cli/onboarding.ts")
    applyOnboardingChoices({ completions: false, skill: true }, "bash", readyEnv())
    expect(mocks.markSkillHintSeen).not.toHaveBeenCalled()
  })

  // install.sh installs Bun and Rove but never Node, so a missing `npx` is the
  // default state for anyone who followed the QUICKSTART. Say Node is missing
  // rather than spawning and pointing at a retry command that needs it too.
  it("explains Node is missing instead of spawning npx", async () => {
    setProduct("rove")
    mocks.isNpxMissing.mockReturnValue(true)
    const { applyOnboardingChoices } = await import("../../src/cli/onboarding.ts")
    applyOnboardingChoices({ completions: false, skill: true }, "bash", readyEnv())
    const lines = stdoutLines(stdoutSpy)
    expect(lines.some((l) => l.includes("npx") && l.includes("Node"))).toBe(true)
    expect(mocks.spawnSync).not.toHaveBeenCalled()
  })

  it("prints a failure hint when the skill installer exits non-zero", async () => {
    setProduct("kobe")
    mocks.spawnSync.mockReturnValue({ status: 1 })
    const { applyOnboardingChoices } = await import("../../src/cli/onboarding.ts")
    applyOnboardingChoices({ completions: false, skill: true }, "zsh", readyEnv())
    const lines = stdoutLines(stdoutSpy)
    expect(lines.some((l) => l.includes("skill install failed"))).toBe(true)
    expect(lines.some((l) => l.includes("kobe skill install"))).toBe(true)
  })
})

describe("maybeRunOnboarding", () => {
  let stdoutSpy: MockInstance<typeof process.stdout.write>

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    mocks.getPersistedBool.mockImplementation((key: string) => false)
    mocks.runOnboardingWizard.mockResolvedValue({ completions: true, skill: false })
    mocks.checkOnboardingEnv.mockResolvedValue(readyEnv())
    // Default: a genuine first run — no version has ever been stamped.
    mocks.loadStateFile.mockReturnValue({})
  })

  afterEach(() => {
    stdoutSpy.mockRestore()
    vi.clearAllMocks()
    process.env.ROVE_INVOKED_AS = undefined
  })

  it("returns false when stdout is not a TTY", async () => {
    const { maybeRunOnboarding } = await import("../../src/cli/onboarding.ts")
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true })
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true })
    expect(await maybeRunOnboarding()).toBe(false)
    expect(mocks.runOnboardingWizard).not.toHaveBeenCalled()
  })

  it("returns false when onboarding AND the primer both completed", async () => {
    mocks.getPersistedBool.mockImplementation((key: string) => key === "onboarded" || key === "onboardedPrimer")
    const { maybeRunOnboarding } = await import("../../src/cli/onboarding.ts")
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true })
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true })
    expect(await maybeRunOnboarding()).toBe(false)
    expect(mocks.runOnboardingWizard).not.toHaveBeenCalled()
  })

  it("marks onboarded, runs the wizard in full mode, applies choices, and returns true", async () => {
    setProduct("kobe")
    const savedShell = process.env.SHELL
    process.env.SHELL = "/bin/zsh"
    const { maybeRunOnboarding } = await import("../../src/cli/onboarding.ts")
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true })
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true })
    const result = await maybeRunOnboarding()
    if (savedShell !== undefined) process.env.SHELL = savedShell
    else process.env.SHELL = undefined
    expect(result).toBe(true)
    expect(mocks.setPersistedBool).toHaveBeenCalledWith("onboarded", true)
    // A resolved wizard delivered the keyboard page — the primer is done too.
    expect(mocks.setPersistedBool).toHaveBeenCalledWith("onboardedPrimer", true)
    expect(mocks.runOnboardingWizard).toHaveBeenCalledWith("zsh", readyEnv(), "full")
    const lines = stdoutLines(stdoutSpy)
    expect(lines.some((l) => l.includes("completions hooked into"))).toBe(true)
  })

  // An ABSENT `onboardedPrimer` cannot mean "killed wizard": an
  // already-onboarded user predating the flag looks identical to one. They
  // must not be handed a surprise wizard on upgrade — and since a `true`
  // return means the caller exits instead of starting the TUI, that upgrade
  // would also cost them the launch they asked for.
  it("never shows the primer to a user who onboarded before the flag existed", async () => {
    setProduct("kobe")
    mocks.getPersistedBool.mockImplementation((key: string) => key === "onboarded")
    // The tell: this install has started successfully at least once.
    mocks.loadStateFile.mockReturnValue({ "app.lastRunVersion": "0.9.40" })
    const { maybeRunOnboarding } = await import("../../src/cli/onboarding.ts")
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true })
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true })
    expect(await maybeRunOnboarding()).toBe(false)
    expect(mocks.runOnboardingWizard).not.toHaveBeenCalled()
    expect(mocks.setPersistedBool).toHaveBeenCalledWith("onboardedPrimer", true)
  })

  it("a killed first-run wizard re-runs once in primer mode — questions stay settled", async () => {
    setProduct("kobe")
    // onboarded was set before the wizard rendered, then the process died:
    // the primer flag never landed.
    mocks.getPersistedBool.mockImplementation((key: string) => key === "onboarded")
    mocks.runOnboardingWizard.mockResolvedValue({ completions: false, skill: false })
    const savedShell = process.env.SHELL
    process.env.SHELL = undefined
    const { maybeRunOnboarding } = await import("../../src/cli/onboarding.ts")
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true })
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true })
    expect(await maybeRunOnboarding()).toBe(true)
    if (savedShell !== undefined) process.env.SHELL = savedShell
    expect(mocks.runOnboardingWizard).toHaveBeenCalledWith(null, readyEnv(), "primer")
    expect(mocks.setPersistedBool).toHaveBeenCalledWith("onboardedPrimer", true)
    const lines = stdoutLines(stdoutSpy)
    // Primer mode applies nothing; the environment summary still prints.
    expect(lines.some((l) => l.includes("completions hooked into"))).toBe(false)
    expect(lines.some((l) => l.includes("git:      ✓"))).toBe(true)
    expect(lines.some((l) => l.includes("You're ready to go!"))).toBe(true)
  })
})
