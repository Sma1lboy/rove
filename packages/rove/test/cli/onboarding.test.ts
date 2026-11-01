/**
 * First-run welcome — the disk-touching half, plus the gate that decides
 * whether the dialog is owed at all.
 *
 * Two things matter here. It edits the user's REAL shell rc, so the append
 * must be idempotent (a re-run, or a `rove completions` marker the user wrote
 * themselves, must never stack duplicate source lines) and fish must get an
 * autoload file rather than an rc edit. And the record/apply split must hold:
 * `recordWelcomeChoices` runs while the TUI owns the screen and may not write
 * a byte to stdout or spawn anything,
 * while `runPendingWelcomeInstalls` runs after the renderer is gone.
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { detectShell, installCompletions } from "../../src/cli/onboarding.ts"

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  getPersistedBool: vi.fn((_key: string) => false),
  setPersistedBool: vi.fn(),
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
function freshHome(): string {
  return mkdtempSync(join(tmpdir(), "rove-onboarding-"))
}

function setProduct(name: "rove" | "rove"): void {
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
  it("never writes to stdout or spawns — the TUI still owns the screen", async () => {
    const { recordWelcomeChoices } = await import("../../src/cli/onboarding.ts")
    recordWelcomeChoices({ completions: true }, "zsh")
    expect(stdoutSpy).not.toHaveBeenCalled()
    expect(mocks.spawnSync).not.toHaveBeenCalled()
  })

  it("records the shell for an accepted completions answer", async () => {
    const { recordWelcomeChoices } = await import("../../src/cli/onboarding.ts")
    recordWelcomeChoices({ completions: true }, "fish")
    expect(mocks.patchStateFile).toHaveBeenCalledWith(expect.objectContaining({ welcomePendingCompletions: "fish" }))
  })

  it("a read-only home loses the deferred install, not the session", async () => {
    mocks.patchStateFile.mockImplementationOnce(() => {
      throw new Error("EROFS")
    })
    const { recordWelcomeChoices } = await import("../../src/cli/onboarding.ts")
    expect(() => recordWelcomeChoices({ completions: true }, "zsh")).not.toThrow()
  })
})

describe("runPendingWelcomeInstalls", () => {
  let stdoutSpy: MockInstance<typeof process.stdout.write>

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.spawnSync.mockReturnValue({ status: 0 })
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

  it("clears the pending flag so the next launch is quiet", async () => {
    mocks.loadStateFile.mockReturnValue({ welcomePendingCompletions: "zsh" })
    const { runPendingWelcomeInstalls } = await import("../../src/cli/onboarding.ts")
    runPendingWelcomeInstalls()
    expect(mocks.patchStateFile).toHaveBeenCalledWith(expect.objectContaining({ welcomePendingCompletions: undefined }))
  })
  it("rejects a corrupted queued shell without writing a shell config", async () => {
    mocks.loadStateFile.mockReturnValue({ welcomePendingCompletions: "../../invalid" })
    const { runPendingWelcomeInstalls } = await import("../../src/cli/onboarding.ts")
    runPendingWelcomeInstalls()
    expect(existsSync(join(mocks.home as string, ".bashrc"))).toBe(false)
    expect(mocks.patchStateFile).toHaveBeenCalledWith(expect.objectContaining({ welcomePendingCompletions: undefined }))
    expect(stdoutLines(stdoutSpy).join("\n")).toContain("invalid pending completion shell")
  })
})

describe("shouldWelcome", () => {
  it("greets a genuine first run — no stamp of either kind", async () => {
    const { shouldWelcome } = await import("../../src/cli/welcome.ts")
    expect(shouldWelcome({})).toBe(true)
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

describe("manual setup retry reconciliation", () => {
  it("clears only the matching successful request", async () => {
    mocks.patchStateFile.mockReset()
    mocks.loadStateFile.mockReturnValue({ welcomePendingCompletions: "zsh" })
    const { settleWelcomeInstall } = await import("../../src/cli/onboarding.ts")
    settleWelcomeInstall("completions", "bash")
    expect(mocks.patchStateFile).not.toHaveBeenCalled()
    settleWelcomeInstall("completions", "zsh")
    expect(mocks.patchStateFile).toHaveBeenCalledWith(expect.objectContaining({ welcomePendingCompletions: undefined }))
  })
})
