import { describe, expect, it } from "vitest"
import { failureSubject, formatCliFailure, summarizeCliGitError } from "../../src/cli/cli-failure.ts"

const GIT_THROW =
  "git worktree list --porcelain (cwd=/private/tmp) exited with code 128: " +
  "fatal: not a git repository (or any of the parent directories): .git"

describe("failureSubject", () => {
  it("names the subcommand that failed", () => {
    expect(failureSubject("rove", ["bun", "/x/rove.js", "adopt"])).toBe("rove adopt")
  })

  /** A bare launch really can fail at startup, and flags/paths route to the
   *  TUI or open-directory paths — neither is a subcommand to blame. */
  it("falls back to the bare CLI name for a launch, a flag, or a path", () => {
    expect(failureSubject("rove", ["bun", "/x/rove.js"])).toBe("rove")
    expect(failureSubject("rove", ["bun", "/x/rove.js", "--help"])).toBe("rove")
    expect(failureSubject("rove", ["bun", "/x/rove.js", "~/code/repo"])).toBe("rove")
  })
})

describe("summarizeCliGitError", () => {
  it("turns a raw git invocation into a sentence naming the directory and the action", () => {
    const summary = summarizeCliGitError(GIT_THROW, "/private/tmp")
    expect(summary).toBe("/private/tmp is not a git repository — run this inside one, or pass a repo path.")
  })

  /** A boil-down that swallows what it does not understand is worse than a
   *  noisy one: the caller passes the original through on null. */
  it("declines shapes it cannot improve", () => {
    expect(summarizeCliGitError("EACCES: permission denied, open '/etc/x'", "/tmp")).toBeNull()
    expect(summarizeCliGitError("boom", "/tmp")).toBeNull()
  })
})

describe("formatCliFailure", () => {
  const opts = { cliName: "rove", argv: ["bun", "/x/rove.js", "adopt"], cwd: "/private/tmp", env: {} }

  it("blames the subcommand, not the process, and leaks no git argv", () => {
    const line = formatCliFailure(new Error(GIT_THROW), opts)

    expect(line).toBe("rove adopt: /private/tmp is not a git repository — run this inside one, or pass a repo path.")
    // The three things the old "rove failed to start:" line got wrong.
    expect(line).not.toContain("failed to start")
    expect(line).not.toContain("(cwd=")
    expect(line).not.toContain("exited with code")
  })

  it("passes an unrecognized message through under the subcommand prefix", () => {
    expect(formatCliFailure(new Error("disk on fire"), opts)).toBe("rove adopt: disk on fire")
  })

  it("keeps the raw throw under KOBE_DEBUG=1 so bug reports still carry the argv", () => {
    const line = formatCliFailure(new Error(GIT_THROW), { ...opts, env: { KOBE_DEBUG: "1" } })

    expect(line).toContain("(cwd=/private/tmp)")
    expect(line).toContain("exited with code 128")
  })
})
