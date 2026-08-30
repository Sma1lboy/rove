/**
 * The engine-owned session contract: every engine answers "what pins my id"
 * and "how do I resume one" for itself, so no neutral layer has to name a
 * vendor. Two regressions this pins:
 *
 *   - claude's pin + resume shapes must not drift (they were the only ones
 *     that ever worked, and the whole feature is worthless if it breaks them);
 *   - `withPinnedSessionId` must answer for a CUSTOM engine by the protocol
 *     it declares, not by whether its id spells "claude" — the literal-name
 *     check in the old `withClaudeSessionId` is exactly why `claudecpa` and
 *     every kimi tab lost their conversation on restart.
 */

import { engineResumeArgv, withPinnedSessionId } from "@/engine/engine-presets"
import { engineEntry } from "@/engine/registry"
import {
  acceptsPinnedSession,
  controlsOwnSession,
  pickUnclaimedSessionId,
  resumeSessionArgv,
} from "@/engine/session-identity"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/state/repos", async (orig) => ({
  ...(await orig<typeof import("@/state/repos")>()),
  getPersistedString: (key: string) => (key === "engineProtocol.claudecpa" ? "claude" : ""),
  getCustomEngineIds: () => ["claudecpa"],
}))

describe("per-engine session declarations", () => {
  it("pins claude's id at launch and resumes it with --resume", () => {
    const { argv, sessionId } = withPinnedSessionId(["claude"], "claude")
    expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(argv).toEqual(["claude", "--session-id", sessionId])
    expect(engineResumeArgv(["claude"], "claude", "u1")).toEqual(["claude", "--resume", "u1"])
  })

  it("defaults an undefined vendor to claude (the launch convention)", () => {
    expect(withPinnedSessionId(["claude"], undefined).sessionId).not.toBeNull()
  })

  it("resumes kimi with -S, and never pins — its CLI can only reopen (probed)", () => {
    expect(withPinnedSessionId(["kimi"], "kimi")).toEqual({ argv: ["kimi"], sessionId: null })
    expect(engineResumeArgv(["kimi", "-y"], "kimi", "sess-9")).toEqual(["kimi", "-y", "-S", "sess-9"])
  })

  it("resumes codex with its subcommand, flags before the positional id", () => {
    expect(withPinnedSessionId(["codex"], "codex")).toEqual({ argv: ["codex"], sessionId: null })
    expect(engineResumeArgv(["codex", "-c", "x=1"], "codex", "t-1")).toEqual(["codex", "resume", "-c", "x=1", "t-1"])
  })

  it("declines both verbs for an engine that declares no session identity", () => {
    expect(withPinnedSessionId(["copilot"], "copilot").sessionId).toBeNull()
    expect(engineResumeArgv(["copilot"], "copilot", "s")).toBeNull()
    expect(engineResumeArgv(["opencode"], "opencode", "s")).toBeNull()
  })

  // The bug the whole change exists for: a wrapper engine is a claude
  // launch, so it must get claude's session verbs. The old literal
  // `vendor === "claude"` gate excluded it by NAME.
  it("gives a custom preset the session verbs of the protocol it declares", () => {
    const { argv, sessionId } = withPinnedSessionId(["claudecpa"], "claudecpa")
    expect(sessionId).not.toBeNull()
    expect(argv).toEqual(["claudecpa", "--session-id", sessionId])
    expect(engineResumeArgv(["claudecpa"], "claudecpa", "u1")).toEqual(["claudecpa", "--resume", "u1"])
  })
})

describe("the user's own session flags always win", () => {
  const claude = engineEntry("claude").sessionIdentity
  const kimi = engineEntry("kimi").sessionIdentity

  it("never appends a second session control to a command that has one", () => {
    for (const flag of ["--session-id", "--resume", "-r", "--continue", "-c", "--from-pr"]) {
      const argv = ["claude", flag, "x"]
      expect(withPinnedSessionId(argv, "claude")).toEqual({ argv, sessionId: null })
      expect(engineResumeArgv(argv, "claude", "u1")).toBeNull()
    }
  })

  it("recognizes the attached --flag=value form the command parser preserves", () => {
    expect(controlsOwnSession(claude, ["claude", "--resume=x"])).toBe(true)
    // Prefix-safe: a longer flag that merely starts the same is not a match.
    expect(controlsOwnSession(claude, ["claude", "--resume-later"])).toBe(false)
  })

  it("leaves a kimi command that already resumes alone", () => {
    expect(controlsOwnSession(kimi, ["kimi", "-S", "sess-1"])).toBe(true)
    expect(engineResumeArgv(["kimi", "-c"], "kimi", "sess-2")).toBeNull()
  })

  it("acceptsPinnedSession is false without a pin flag, whatever the argv", () => {
    expect(acceptsPinnedSession(kimi, ["kimi"])).toBe(false)
    expect(acceptsPinnedSession(claude, ["claude"])).toBe(true)
    expect(acceptsPinnedSession(undefined, ["x"])).toBe(false)
  })

  it("resumeSessionArgv refuses an empty id rather than passing a blank flag", () => {
    expect(resumeSessionArgv(claude, ["claude"], "")).toBeNull()
  })
})

// Why: the session store answers per-WORKTREE, so every tab of a task sees
// the same list. Without claim-tracking two kimi tabs would both adopt the
// newest session and fight over one conversation.
describe("pickUnclaimedSessionId", () => {
  it("takes the newest id no sibling tab already holds", () => {
    expect(pickUnclaimedSessionId(["old", "mid", "new"], new Set())).toBe("new")
    expect(pickUnclaimedSessionId(["old", "mid", "new"], new Set(["new"]))).toBe("mid")
    expect(pickUnclaimedSessionId(["old", "mid", "new"], new Set(["new", "mid"]))).toBe("old")
  })

  it("answers null rather than handing back a claimed or absent session", () => {
    expect(pickUnclaimedSessionId([], new Set())).toBeNull()
    expect(pickUnclaimedSessionId(["a"], new Set(["a"]))).toBeNull()
  })
})
