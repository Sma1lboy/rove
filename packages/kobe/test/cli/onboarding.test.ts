/**
 * First-run welcome — the disk-touching half, plus the gate that decides
 * whether the dialog is owed at all.
 *
 * Two things matter here. It edits the user's REAL shell rc, so the append
 * must be idempotent (a re-run, or a `rove completions` marker the user wrote
 * themselves, must never stack duplicate source lines) and fish must get an
 * autoload file rather than an rc edit. And the record/apply split must hold:
 * `recordWelcomeChoices` runs while the TUI owns the screen and may not write
 * a byte to stdout or spawn anything, while `runPendingWelcomeInstalls` runs
 * after the renderer is gone and owns both.
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
  loadStateFile: vi.fn(() => ({}) as Record<string, unknown>),
  patchStateFile: vi.fn(),
  /** The home `os.homedir()` reports; undefined = the real one. */
  home: undefined as string | undefined,
}))

vi.mock("node:child_process", () => ({ spawnSync: mocks.spawnSync }))
// The install path writes the completions hook into `os.homedir()`. Redirect it
// at the source rather than through $HOME, which Windows ignores — otherwise
// these tests write into the developer's (or CI runner's) real rc file, and one
// test's leftover hook decides the next test's answer. `tmpdir()` stays real so
// `freshHome()` still makes a temp directory.
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>()
  return { ...actual, homedir: () => mocks.home ?? actual.homedir() }
})
vi.mock("../../src/state/store.ts", () => ({
  getPersistedBool: mocks.getPersistedBool,
  setPersistedBool: mocks.setPersistedBool,
  loadStateFile: mocks.loadStateFile,
  patchStateFile: mocks.patchStateFile,
}))
vi.mock("../../src/lib/skill-install.ts", () => ({
  npxSkillsArgv: mocks.npxSkillsArgv,
  npxSkillsCommand: mocks.npxSkillsCommand,
  isNpxMissing: mocks.isNpxMissing,
  markSkillHintSeen: mocks.markSkillHintSeen,
}))
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
      signedOut: [],
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
      signedOut: [],
    },
  }
}

function setProduct(name: "rove" | "kobe"): void {
  if (name === "rove") process.env.ROVE_INVOKED_AS = "rove"
  // Assigning `undefined` stores the literal string "undefined", which reads
  // as legacy only by accident. Delete it so the legacy case is the real one.
  else Reflect.deleteProperty(process.env, "ROVE_INVOKED_AS")
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
    const { path: rc, installed } = installCompletions("zsh", home, "rove")
    expect(installed).toBe(true)
    expect(rc).toBe(join(home, ".zshrc"))
    const content = readFileSync(rc, "utf8")
    expect(content).toContain("source <(rove completions zsh)")
    expect(content).toContain("command -v rove")
  })

  it("is idempotent — a second run never stacks a duplicate line", () => {
    const home = freshHome()
    installCompletions("zsh", home, "rove")
    const second = installCompletions("zsh", home, "rove")
    expect(second.installed).toBe(false)
    const content = readFileSync(join(home, ".zshrc"), "utf8")
    expect(content.match(/rove completions zsh/g)).toHaveLength(1)
  })

  it("preserves an existing rc and respects a hand-rolled rove completions block", () => {
    const home = freshHome()
    const rc = join(home, ".bashrc")
    writeFileSync(rc, "# mine\nsource ~/.bash_completion.d/rove # rove completions via fpath\n")
    const { installed } = installCompletions("bash", home, "rove")
    // The marker was already present → nothing appended, and it says so.
    expect(installed).toBe(false)
    const content = readFileSync(rc, "utf8")
    expect(content).toContain("# mine")
    expect(content).not.toContain("source <(rove completions bash)")
  })

  it("fish gets an autoloaded completions file, no rc edit", () => {
    const home = freshHome()
    const { path, installed } = installCompletions("fish", home, "rove")
    expect(installed).toBe(true)
    expect(path).toBe(join(home, ".config", "fish", "completions", "rove.fish"))
    expect(readFileSync(path, "utf8")).toBe("rove completions fish | source\n")
    expect(existsSync(join(home, ".config", "fish", "config.fish"))).toBe(false)
  })

  it("uses the active cli name (kobe) when no product is pinned", () => {
    const home = freshHome()
    const { path: rc } = installCompletions("zsh", home)
    const content = readFileSync(rc, "utf8")
    expect(content).toContain("source <(kobe completions zsh)")
    expect(content).toContain("command -v kobe")
  })

  it("sources the pre-generated script when one exists — no subprocess at shell start", () => {
    const home = freshHome()
    const shipped = join(freshHome(), "rove.zsh")
    writeFileSync(shipped, "#compdef rove\n")
    expect(installCompletions("zsh", home, "rove", shipped).installed).toBe(true)
    const second = installCompletions("zsh", home, "rove", shipped)
    expect(second.installed).toBe(false)
    const content = readFileSync(second.path, "utf8")
    expect(content).toContain(`[ -f "${shipped}" ] && source "${shipped}"`)
    // The whole point: nothing on this line spawns a process.
    expect(content).not.toContain("source <(")
    expect(content).not.toContain("command -v")
    // …and the second run is a no-op, not a stacked duplicate.
    expect(content.match(/source "/g)).toHaveLength(1)
  })

  it("upgrades an rc line written before the scripts were pre-generated", () => {
    const home = freshHome()
    const rc = join(home, ".zshrc")
    writeFileSync(rc, "# mine\n\n# rove completions\ncommand -v rove >/dev/null && source <(rove completions zsh)\n")
    const shipped = join(freshHome(), "rove.zsh")
    writeFileSync(shipped, "#compdef rove\n")
    const { installed } = installCompletions("zsh", home, "rove", shipped)
    expect(installed).toBe(true)
    const content = readFileSync(rc, "utf8")
    expect(content).toContain("# mine")
    expect(content).toContain(`source "${shipped}"`)
    expect(content).not.toContain("source <(")
  })

  it("fish autoloads a guard over the shipped script", () => {
    const home = freshHome()
    const shipped = join(freshHome(), "rove.fish")
    writeFileSync(shipped, "# rove fish completions\n")
    const { path } = installCompletions("fish", home, "rove", shipped)
    expect(readFileSync(path, "utf8")).toBe(`test -f "${shipped}"; and source "${shipped}"\n`)
  })
})

describe("recordWelcomeChoices", () => {
  let stdoutSpy: MockInstance<typeof process.stdout.write>

  beforeEach(() => {
    vi.clearAllMocks()
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true)
  })
  afterEach(() => stdoutSpy.mockRestore())

  /**
   * The load-bearing invariant of the record/apply split: this runs while the
   * TUI still owns the screen. One stray line here repaints over the
   * renderer's cells, and the corruption reads as an opentui bug rather than
   * as a greeting that spoke out of turn.
   */
  it("never writes to stdout — the TUI still owns the screen", async () => {
    const { recordWelcomeChoices } = await import("../../src/cli/onboarding.ts")
    recordWelcomeChoices({ completions: true, skill: true }, "zsh")
    expect(stdoutSpy).not.toHaveBeenCalled()
  })

  it("never spawns — npx waits until the renderer is gone", async () => {
    const { recordWelcomeChoices } = await import("../../src/cli/onboarding.ts")
    recordWelcomeChoices({ completions: true, skill: true }, "zsh")
    expect(mocks.spawnSync).not.toHaveBeenCalled()
  })

  it("records the shell for an accepted completions answer", async () => {
    const { recordWelcomeChoices } = await import("../../src/cli/onboarding.ts")
    recordWelcomeChoices({ completions: true, skill: false }, "fish")
    expect(mocks.patchStateFile).toHaveBeenCalledWith(expect.objectContaining({ welcomePendingCompletions: "fish" }))
  })

  it("records nothing for completions when no shell was detected", async () => {
    const { recordWelcomeChoices } = await import("../../src/cli/onboarding.ts")
    recordWelcomeChoices({ completions: true, skill: false }, null)
    expect(mocks.patchStateFile).toHaveBeenCalledWith(expect.objectContaining({ welcomePendingCompletions: undefined }))
  })

  it("a declined skill settles the one-time startup hint — the user just answered it", async () => {
    const { recordWelcomeChoices } = await import("../../src/cli/onboarding.ts")
    recordWelcomeChoices({ completions: false, skill: false }, "zsh")
    expect(mocks.markSkillHintSeen).toHaveBeenCalled()
  })

  it("an accepted skill leaves the hint alone — the installer speaks for it", async () => {
    const { recordWelcomeChoices } = await import("../../src/cli/onboarding.ts")
    recordWelcomeChoices({ completions: false, skill: true }, "zsh")
    expect(mocks.markSkillHintSeen).not.toHaveBeenCalled()
  })

  it("a read-only home loses the deferred install, not the session", async () => {
    mocks.patchStateFile.mockImplementationOnce(() => {
      throw new Error("EROFS")
    })
    const { recordWelcomeChoices } = await import("../../src/cli/onboarding.ts")
    expect(() => recordWelcomeChoices({ completions: true, skill: true }, "zsh")).not.toThrow()
  })
})

describe("runPendingWelcomeInstalls", () => {
  let stdoutSpy: MockInstance<typeof process.stdout.write>

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.spawnSync.mockReturnValue({ status: 0 })
    mocks.isNpxMissing.mockReturnValue(false)
    mocks.home = freshHome()
    setProduct("rove")
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true)
  })
  afterEach(() => {
    stdoutSpy.mockRestore()
    mocks.home = undefined
  })

  /** Every launch but the one right after the dialog takes this path. */
  it("is a no-op with nothing pending — no spawn, no output, no state write", async () => {
    mocks.loadStateFile.mockReturnValue({})
    const { runPendingWelcomeInstalls } = await import("../../src/cli/onboarding.ts")
    runPendingWelcomeInstalls()
    expect(mocks.spawnSync).not.toHaveBeenCalled()
    expect(stdoutSpy).not.toHaveBeenCalled()
    expect(mocks.patchStateFile).not.toHaveBeenCalled()
  })

  it("installs completions and reports the file it touched", async () => {
    mocks.loadStateFile.mockReturnValue({ welcomePendingCompletions: "zsh" })
    const { runPendingWelcomeInstalls } = await import("../../src/cli/onboarding.ts")
    runPendingWelcomeInstalls()
    const rc = join(mocks.home as string, ".zshrc")
    expect(readFileSync(rc, "utf8")).toContain("rove completions zsh")
    expect(stdoutLines(stdoutSpy).join("\n")).toContain(rc)
  })

  it("runs the skill installer with a real terminal", async () => {
    mocks.loadStateFile.mockReturnValue({ welcomePendingSkillInstall: true })
    const { runPendingWelcomeInstalls } = await import("../../src/cli/onboarding.ts")
    runPendingWelcomeInstalls()
    expect(mocks.spawnSync).toHaveBeenCalledWith("npx", ["skills", "add", "stub"], { stdio: "inherit" })
  })

  it("says what is missing when npx is absent, not to re-run a verb that needs it", async () => {
    mocks.isNpxMissing.mockReturnValue(true)
    mocks.loadStateFile.mockReturnValue({ welcomePendingSkillInstall: true })
    const { runPendingWelcomeInstalls } = await import("../../src/cli/onboarding.ts")
    runPendingWelcomeInstalls()
    expect(mocks.spawnSync).not.toHaveBeenCalled()
    expect(stdoutLines(stdoutSpy).join("\n")).toContain("Node")
  })

  it("reports a failed install instead of claiming success", async () => {
    mocks.spawnSync.mockReturnValue({ status: 1 })
    mocks.loadStateFile.mockReturnValue({ welcomePendingSkillInstall: true })
    const { runPendingWelcomeInstalls } = await import("../../src/cli/onboarding.ts")
    runPendingWelcomeInstalls()
    expect(stdoutLines(stdoutSpy).join("\n")).toContain("rove skill install")
  })

  it("clears the pending flags so the next launch is quiet", async () => {
    mocks.loadStateFile.mockReturnValue({ welcomePendingCompletions: "zsh", welcomePendingSkillInstall: true })
    const { runPendingWelcomeInstalls } = await import("../../src/cli/onboarding.ts")
    runPendingWelcomeInstalls()
    expect(mocks.patchStateFile).toHaveBeenCalledWith({
      welcomePendingCompletions: undefined,
      welcomePendingSkillInstall: undefined,
    })
  })
})

describe("shouldWelcome", () => {
  it("greets a genuine first run — no stamp of either kind", async () => {
    const { shouldWelcome } = await import("../../src/cli/welcome.ts")
    expect(shouldWelcome({})).toBe(true)
  })

  it("never greets twice", async () => {
    const { shouldWelcome } = await import("../../src/cli/welcome.ts")
    expect(shouldWelcome({ welcomed: true })).toBe(false)
  })

  /**
   * The upgrade regression this guards: `welcomed` only started being written
   * in this build, so its absence is ambiguous. `app.lastRunVersion` is
   * written on every successful start, so anyone who has ever reached the TUI
   * is by definition not a first-run user and must not be greeted.
   */
  it("never greets an existing user who onboarded before the key existed", async () => {
    const { shouldWelcome } = await import("../../src/cli/welcome.ts")
    expect(shouldWelcome({ "app.lastRunVersion": "0.9.200" })).toBe(false)
  })
})
