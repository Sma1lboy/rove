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
import { detectShell, installCompletions } from "../../src/cli/onboarding.ts"

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  getPersistedBool: vi.fn(() => false),
  setPersistedBool: vi.fn(),
  npxSkillsArgv: vi.fn(() => ["skills", "add", "stub"]),
  npxSkillsCommand: vi.fn(() => "npx skills add stub"),
  runOnboardingWizard: vi.fn(),
}))

vi.mock("node:child_process", () => ({ spawnSync: mocks.spawnSync }))
vi.mock("../../src/state/store.ts", () => ({
  getPersistedBool: mocks.getPersistedBool,
  setPersistedBool: mocks.setPersistedBool,
}))
vi.mock("../../src/lib/skill-install.ts", () => ({
  npxSkillsArgv: mocks.npxSkillsArgv,
  npxSkillsCommand: mocks.npxSkillsCommand,
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
  })

  afterEach(() => {
    stdoutSpy.mockRestore()
    vi.clearAllMocks()
    process.env.ROVE_INVOKED_AS = undefined
  })

  it("declines everything when shell is unknown", async () => {
    setProduct("kobe")
    const { applyOnboardingChoices } = await import("../../src/cli/onboarding.ts")
    applyOnboardingChoices({ completions: false, skill: false }, null)
    const lines = stdoutLines(stdoutSpy)
    expect(lines.some((l) => l.includes("kobe skill install"))).toBe(true)
    expect(lines.some((l) => l.includes("kobe completions --help"))).toBe(false)
    expect(lines.some((l) => l.includes("You're ready to go!"))).toBe(true)
  })

  it("installs completions and the skill when both chosen (kobe)", async () => {
    setProduct("kobe")
    mocks.spawnSync.mockReturnValue({ status: 0 })
    const { applyOnboardingChoices } = await import("../../src/cli/onboarding.ts")
    applyOnboardingChoices({ completions: true, skill: true }, "zsh")
    const lines = stdoutLines(stdoutSpy)
    expect(lines.some((l) => l.includes("completions hooked into"))).toBe(true)
    expect(lines.some((l) => l.includes("installing the Rove agent skill"))).toBe(true)
    expect(mocks.spawnSync).toHaveBeenCalledWith("npx", ["skills", "add", "stub"], { stdio: "inherit" })
  })

  it("uses the rove CLI name when invoked as rove", async () => {
    setProduct("rove")
    const { applyOnboardingChoices } = await import("../../src/cli/onboarding.ts")
    applyOnboardingChoices({ completions: false, skill: false }, "bash")
    const lines = stdoutLines(stdoutSpy)
    expect(lines.some((l) => l.includes("rove completions --help"))).toBe(true)
    expect(lines.some((l) => l.includes("rove skill install"))).toBe(true)
    expect(lines.some((l) => l.includes("kobe"))).toBe(false)
  })

  it("prints a failure hint when the skill installer exits non-zero", async () => {
    setProduct("kobe")
    mocks.spawnSync.mockReturnValue({ status: 1 })
    const { applyOnboardingChoices } = await import("../../src/cli/onboarding.ts")
    applyOnboardingChoices({ completions: false, skill: true }, "zsh")
    const lines = stdoutLines(stdoutSpy)
    expect(lines.some((l) => l.includes("skill install failed"))).toBe(true)
    expect(lines.some((l) => l.includes("kobe skill install"))).toBe(true)
  })
})

describe("maybeRunOnboarding", () => {
  let stdoutSpy: MockInstance<typeof process.stdout.write>

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    mocks.getPersistedBool.mockReturnValue(false)
    mocks.runOnboardingWizard.mockResolvedValue({ completions: true, skill: false })
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

  it("returns false when already onboarded", async () => {
    mocks.getPersistedBool.mockReturnValue(true)
    const { maybeRunOnboarding } = await import("../../src/cli/onboarding.ts")
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true })
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true })
    expect(await maybeRunOnboarding()).toBe(false)
    expect(mocks.runOnboardingWizard).not.toHaveBeenCalled()
  })

  it("marks onboarded, runs the wizard, applies choices, and returns true", async () => {
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
    expect(mocks.runOnboardingWizard).toHaveBeenCalledWith("zsh")
    const lines = stdoutLines(stdoutSpy)
    expect(lines.some((l) => l.includes("completions hooked into"))).toBe(true)
  })
})
