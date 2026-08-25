import { describe, expect, it } from "vitest"
import type { DetectDeps } from "../../src/engine/account-detect.ts"
import { detectEngineStatus, detectEngineStatuses, probeLaunchBinary } from "../../src/engine/engine-status.ts"

/** Every built-in binary missing, no files/env — overridable per test. */
function accountDeps(over: Partial<DetectDeps> = {}): DetectDeps {
  const missing = async (): Promise<string> => {
    throw new Error("not found")
  }
  return {
    readFile: () => null,
    env: () => undefined,
    home: () => "/home/u",
    findClaudeBinary: missing,
    findCodexBinary: missing,
    findCopilotBinary: missing,
    findKimiBinary: missing,
    ...over,
  }
}

describe("probeLaunchBinary", () => {
  it("resolves a bare command name through which", () => {
    expect(probeLaunchBinary(["gemini", "--yolo"], (b) => (b === "gemini" ? "/usr/bin/gemini" : null))).toEqual({
      found: true,
      path: "/usr/bin/gemini",
    })
  })

  it("reports a PATH miss instead of throwing", () => {
    expect(probeLaunchBinary(["nope"], () => null)).toEqual({ found: false, error: "not found on PATH" })
  })

  it("stats an explicit path rather than searching PATH", () => {
    expect(probeLaunchBinary([process.execPath], () => null)).toEqual({ found: true, path: process.execPath })
    expect(probeLaunchBinary(["/definitely/not/here"], () => "/usr/bin/here")).toEqual({
      found: false,
      error: "not found at /definitely/not/here",
    })
  })

  it("treats an empty command as a miss", () => {
    expect(probeLaunchBinary([], () => "/x")).toEqual({ found: false, error: "no launch command" })
  })
})

describe("detectEngineStatus", () => {
  it("probes an engine without an account detector from its launch command", async () => {
    const status = await detectEngineStatus("opencode", {
      command: () => ["opencode"],
      which: (b) => (b === "opencode" ? "/usr/local/bin/opencode" : null),
    })
    // `null` account means "no detector for this engine" — NOT "not logged in".
    expect(status).toEqual({
      vendor: "opencode",
      binary: { found: true, path: "/usr/local/bin/opencode" },
      account: null,
    })
  })

  it("reads a built-in's account through its own detector", async () => {
    const status = await detectEngineStatus("claude", {
      command: () => ["claude"],
      which: () => null,
      accountDeps: accountDeps({
        findClaudeBinary: async () => "/bin/claude",
        readFile: () => JSON.stringify({ oauthAccount: { emailAddress: "a@b.com" } }),
      }),
    })
    expect(status.binary).toEqual({ found: true, path: "/bin/claude" })
    expect(status.account).toMatchObject({ kind: "oauth", email: "a@b.com" })
  })

  it("falls back to the launch-command override when a built-in's finder misses", async () => {
    const status = await detectEngineStatus("codex", {
      command: () => ["cx"], // user's `engineCommand.codex` override
      which: (b) => (b === "cx" ? "/opt/cx" : null),
      accountDeps: accountDeps(),
    })
    expect(status.binary).toEqual({ found: true, path: "/opt/cx" })
    expect(status.account).toEqual({ kind: "none" })
  })

  it("keeps a built-in's not-found error when nothing resolves", async () => {
    const status = await detectEngineStatus("kimi", {
      command: () => ["kimi"],
      which: () => null,
      accountDeps: accountDeps(),
    })
    expect(status.binary.found).toBe(false)
  })

  it("probes a list in order", async () => {
    const statuses = await detectEngineStatuses(["amp", "droid"], {
      command: (v) => [v],
      which: (b) => (b === "amp" ? "/bin/amp" : null),
    })
    expect(statuses.map((s) => [s.vendor, s.binary.found])).toEqual([
      ["amp", true],
      ["droid", false],
    ])
  })
})
