import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ACTIVITY_EXTENSION_FILE,
  PiFamilyHookAdapter,
  piActivityExtensionPath,
  piExtensionsDir,
} from "../../src/engine/pi-local/hook-adapter.ts"
import { trustPiWorktree } from "../../src/engine/pi-local/trust.ts"

// Pin the CLI invocation module whole (same rule as the kimi/codex adapter
// tests: vi.mock replaces EVERY export, so a new invocation.ts function would
// otherwise reach these assertions as undefined()).
vi.mock("../../src/cli/invocation.ts", () => ({
  roveCliInvocation: () => ["kobe"],
  kobeHookInvocation: () => ["kobe"],
}))

describe("PiFamilyHookAdapter", () => {
  const pi = new PiFamilyHookAdapter("pi")
  const omp = new PiFamilyHookAdapter("omp")

  it("serves both family ids off one implementation", () => {
    expect(pi.vendor).toBe("pi")
    expect(omp.vendor).toBe("omp")
    expect(pi.supportsHooks()).toBe(true)
    expect(omp.supportsHooks()).toBe(true)
  })

  it("installs into each CLI's own agent directory", () => {
    expect(pi.globalSettingsPath().endsWith(join(".pi", "agent", "extensions", ACTIVITY_EXTENSION_FILE))).toBe(true)
    expect(omp.globalSettingsPath().endsWith(join(".omp", "agent", "extensions", ACTIVITY_EXTENSION_FILE))).toBe(true)
  })

  it("never installed the legacy worktree hooks → nothing to clean up", () => {
    expect(pi.supportsWorktreeSync()).toBe(false)
  })

  it("classifies a permission wait and reads the tool name", () => {
    expect(pi.activityDetailFromPayload("awaiting-input", { waiting: "permission" })).toEqual({ waiting: "permission" })
    // The question tool blocks on an answer, which is a different plugin event.
    expect(pi.activityDetailFromPayload("awaiting-input", { waiting: "input" })).toEqual({ waiting: "input" })
    // An older extension that sent no `waiting` stays a permission wait.
    expect(pi.activityDetailFromPayload("awaiting-input", {})).toEqual({ waiting: "permission" })
    expect(pi.activityDetailFromPayload("tool-pre", { tool_name: "bash" })).toEqual({ tool: { name: "bash" } })
    expect(pi.activityDetailFromPayload("turn-complete", {})).toBeUndefined()
  })

  it("separates a rate limit from a billing wall — they need different actions", () => {
    // The daemon arms an auto-resume timer for the first and refuses to for
    // the second: an empty balance does not refill on a clock.
    expect(pi.activityDetailFromPayload("turn-failed", { error_message: "429 Too Many Requests" })?.failure).toBe(
      "rate_limit",
    )
    expect(pi.activityDetailFromPayload("turn-failed", { error_message: "Rate limit exceeded" })?.failure).toBe(
      "rate_limit",
    )
    expect(
      pi.activityDetailFromPayload("turn-failed", { error_message: "402 Payment Required: insufficient credits" })
        ?.failure,
    ).toBe("billing")
    expect(pi.activityDetailFromPayload("turn-failed", { error_message: "socket hang up" })?.failure).toBe("other")
  })

  it("extracts the session identity the extension reports", () => {
    expect(pi.sessionFromPayload({ session_id: "s1", transcript_path: "/x/s.jsonl" })).toEqual({
      sessionId: "s1",
      transcriptPath: "/x/s.jsonl",
    })
    expect(pi.sessionFromPayload({ transcript_path: "/x/s.jsonl" })).toBeUndefined()
    expect(pi.sessionFromPayload({})).toBeUndefined()
  })

  describe("install", () => {
    let home: string
    let agentDir: string

    beforeEach(async () => {
      home = await mkdtemp(join(tmpdir(), "rove-pi-hooks-"))
      agentDir = join(home, ".pi", "agent")
    })

    afterEach(async () => {
      await rm(home, { recursive: true, force: true })
    })

    function installPath(vendor: "pi" | "omp" = "pi"): string {
      return piActivityExtensionPath(vendor, { env: () => undefined, home: () => home })
    }

    it("writes the extension into <agentDir>/extensions", async () => {
      await mkdir(agentDir, { recursive: true })
      expect(await pi.installActivityHooks(installPath())).toEqual({ ok: true })
      const written = await readFile(installPath(), "utf8")
      expect(installPath()).toBe(
        join(piExtensionsDir("pi", { env: () => undefined, home: () => home }), "rove-activity.ts"),
      )
      // The CLI loads the module's default export; the argv is the hook channel.
      expect(written).toContain("export default function (pi)")
      expect(written).toContain('"hook",')
      expect(written).toContain('"--engine",')
    })

    it("skips the install when the agent directory was never created", async () => {
      // No ~/.pi at all means no pi to read the extension — not a refusal,
      // just nothing to install for (same contract as the Kimi adapter).
      expect(await pi.installActivityHooks(installPath())).toEqual({ ok: true })
      expect(existsSync(installPath())).toBe(false)
    })

    it("reinstalls byte-identically rather than rewriting every launch", async () => {
      await mkdir(agentDir, { recursive: true })
      await pi.installActivityHooks(installPath())
      const before = await readFile(installPath(), "utf8")
      await pi.installActivityHooks(installPath())
      expect(await readFile(installPath(), "utf8")).toBe(before)
      expect(before).toContain('pi.on("tool_call"') // the ungated question hook
    })

    it("leaves no extension behind after remove", async () => {
      await mkdir(agentDir, { recursive: true })
      await pi.installActivityHooks(installPath())
      await pi.removeActivityHooks(installPath())
      expect(existsSync(installPath())).toBe(false)
      // Idempotent: removing what is not there must not throw.
      await expect(pi.removeActivityHooks(installPath())).resolves.toBeUndefined()
    })

    it("carries the tool family only under the plugin volume gate", async () => {
      await mkdir(agentDir, { recursive: true })
      await pi.installActivityHooks(installPath())
      // `tool_call` itself is always present (the question-tool report), so
      // the gate is read off the family's own verbs.
      expect(await readFile(installPath(), "utf8")).not.toContain('"tool-pre"')
      await pi.installActivityHooks(installPath(), { toolEvents: true })
      expect(await readFile(installPath(), "utf8")).toContain('"tool-pre"')
    })

    it("keeps the two vendors' install paths apart", async () => {
      await mkdir(agentDir, { recursive: true })
      expect(installPath("omp")).not.toBe(installPath("pi"))
    })
  })
})

describe("trustPiWorktree", () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "rove-pi-trust-"))
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  it("adds the worktree to an existing trust store without dropping it", async () => {
    const target = join(home, "worktree")
    await mkdir(join(home, ".pi", "agent"), { recursive: true })
    const store = join(home, ".pi", "agent", "trust.json")
    await writeFile(store, JSON.stringify({ "/some/other": true, "/declined": false }))

    trustPiWorktree(target, { env: () => undefined, home: () => home })

    const written = JSON.parse(await readFile(store, "utf8"))
    // The store is keyed by the CANONICAL path (pi resolves with realpath),
    // which on macOS differs from the temp path by the /private prefix.
    const keys = Object.keys(written)
    expect(keys.some((k) => k.endsWith("worktree"))).toBe(true)
    expect(keys.find((k) => k.endsWith("worktree"))).not.toBe("/some/other")
    expect(written["/some/other"]).toBe(true)
    expect(written["/declined"]).toBe(false)
  })

  it("leaves an unparseable store alone instead of replacing it", async () => {
    await mkdir(join(home, ".pi", "agent"), { recursive: true })
    const store = join(home, ".pi", "agent", "trust.json")
    await writeFile(store, "not json at all")
    trustPiWorktree(join(home, "worktree"), { env: () => undefined, home: () => home })
    expect(await readFile(store, "utf8")).toBe("not json at all")
  })
})
