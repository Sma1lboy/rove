import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CodexHookAdapter, KOBE_CODEX_HOOK_EVENTS, codexHooksPath } from "../../src/engine/codex-local/hook-adapter.ts"

// The adapter's install path builds hook commands from `kobeHookInvocation()`
// (whose dev fallback is `roveCliInvocation()`). Pin the whole module so the
// roundtrip exercises the merge/IO, not CLI-path resolution. NOTE: vi.mock
// replaces EVERY export — a new function
// added to invocation.ts must be stubbed here too, or json-hooks' default-arg
// call becomes undefined() and editJsonSettings' best-effort catch silently
// eats it (that exact gap shipped red CI once).
vi.mock("../../src/cli/invocation.ts", () => ({
  roveCliInvocation: () => ["kobe"],
  kobeHookInvocation: () => ["kobe"],
}))

describe("CodexHookAdapter", () => {
  const adapter = new CodexHookAdapter()

  // Field names + nullability taken from the `stop.command.input` JSON schema
  // embedded in codex-cli 0.153.2's binary, which REQUIRES both keys. Without
  // this the daemon records a turn-complete carrying no transcript, so codex's
  // turn reader is never reached and `agent-turns` stays empty.
  it("extracts session identity from a Stop payload", () => {
    expect(
      adapter.sessionFromPayload({
        hook_event_name: "Stop",
        session_id: "01a060d6-aae5-7c90-91c0-d5f81da8f343",
        transcript_path: "/Users/x/.codex/sessions/2026/09/01/rollout-x.jsonl",
        model: "gpt-5.6-luna",
      }),
    ).toEqual({
      sessionId: "01a060d6-aae5-7c90-91c0-d5f81da8f343",
      transcriptPath: "/Users/x/.codex/sessions/2026/09/01/rollout-x.jsonl",
    })
  })

  it("tolerates the schema's nullable transcript_path and an absent session", () => {
    expect(adapter.sessionFromPayload({ session_id: "s1", transcript_path: null })).toEqual({ sessionId: "s1" })
    expect(adapter.sessionFromPayload({ transcript_path: "/t.jsonl" })).toBeUndefined()
  })

  it("declares itself a wired hook engine writing ~/.codex/hooks.json", () => {
    expect(adapter.vendor).toBe("codex")
    expect(adapter.supportsHooks()).toBe(true)
    expect(adapter.globalSettingsPath()).toBe(codexHooksPath())
    expect(adapter.globalSettingsPath().endsWith(join(".codex", "hooks.json"))).toBe(true)
  })

  it("never installed the legacy WorktreeCreate hook → nothing to clean up", () => {
    expect(adapter.supportsWorktreeSync()).toBe(false)
  })

  it("decodes no extra detail (no failure/permission events are wired)", () => {
    expect(adapter.activityDetailFromPayload("turn-complete", {})).toBeUndefined()
    expect(adapter.activityDetailFromPayload("turn-failed", { error_type: "rate_limit" })).toBeUndefined()
  })

  it("owns exactly the events Codex can deliver safely", () => {
    expect([...KOBE_CODEX_HOOK_EVENTS].sort()).toEqual(
      [
        "SessionStart",
        "SessionEnd",
        "Stop",
        "UserPromptSubmit",
        "PreCompact",
        "PostCompact",
        "SubagentStart",
        "SubagentStop",
        "PreToolUse",
        "PostToolUse",
      ].sort(),
    )
    // The verbs with no clean Codex signal stay OUT: Codex's enum has no
    // failure event at all, and its only "waiting" event is PermissionRequest
    // — an allow/deny DECISION hook Rove must not observe.
    for (const absent of ["StopFailure", "PostToolUseFailure", "Notification", "PermissionRequest", "TurnFailed"]) {
      expect(KOBE_CODEX_HOOK_EVENTS).not.toContain(absent)
    }
  })
})

describe("CodexHookAdapter install/remove roundtrip (real file)", () => {
  let dir: string
  let file: string
  const adapter = new CodexHookAdapter()

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kobe-codex-hooks-"))
    file = join(dir, "hooks.json")
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function readHooks(): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(file, "utf8")).hooks
  }

  it("creates a missing settings file", async () => {
    await adapter.installActivityHooks(file)

    const hooks = await readHooks()
    expect(hooks.SessionStart).toBeDefined()
    expect(hooks.UserPromptSubmit).toBeDefined()
    expect(hooks.Stop).toBeDefined()
  })

  it("leaves a malformed settings file untouched", async () => {
    const malformed = '{"model":"gpt-5",'
    await writeFile(file, malformed)

    await adapter.installActivityHooks(file)
    await adapter.removeWorktreeWatchHook(file)

    expect(await readFile(file, "utf8")).toBe(malformed)
  })

  it("installs the session, turn, compaction and subagent events, preserving the user's hooks", async () => {
    // Seed a user-authored hook that must survive kobe's merge.
    await writeFile(file, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "user-stop" }] }] } }))

    await adapter.installActivityHooks(file)

    const hooks = await readHooks()
    expect(hooks.SessionStart).toBeDefined()
    expect(hooks.UserPromptSubmit).toBeDefined()
    expect(hooks.Stop).toBeDefined()
    // SessionEnd closes the session out — without it a cleanly-quit codex task
    // keeps whatever state its last hook set.
    expect(JSON.stringify(hooks.SessionEnd)).toContain("session-end")
    expect(JSON.stringify(hooks.SubagentStart)).toContain("subagent-start")
    expect(JSON.stringify(hooks.SubagentStop)).toContain("subagent-stop")
    // Codex never delivers these → kobe must not install them.
    expect(hooks.StopFailure).toBeUndefined()
    expect(hooks.Notification).toBeUndefined()
    expect(hooks.PermissionRequest).toBeUndefined()
    // kobe's Stop coexists with the user's Stop hook.
    expect(JSON.stringify(hooks.Stop)).toContain("turn-complete")
    expect(JSON.stringify(hooks.Stop)).toContain("user-stop")
    // The PostToolUse(Bash) watch observer is never installed.
    expect(hooks.PostToolUse).toBeUndefined()
  })

  it("removal strips kobe's hooks but keeps the user's", async () => {
    await writeFile(file, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "user-stop" }] }] } }))
    await adapter.installActivityHooks(file)

    await adapter.removeActivityHooks(file)

    const hooks = await readHooks()
    expect(JSON.stringify(hooks.Stop)).toContain("user-stop")
    expect(JSON.stringify(hooks.Stop)).not.toContain("turn-complete")
    expect(hooks.SessionStart).toBeUndefined()
  })

  // End-to-end uninstall through real file I/O: this is what an upgrading user
  // gets on their next launch. The watch hook goes; a co-resident hook from
  // another tool must survive, and a second launch must not churn the file.
  it("uninstalls an already-registered watch hook, sparing another tool's entry", async () => {
    await writeFile(
      file,
      JSON.stringify({
        hooks: {
          PostToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "'kobe' 'hook' 'worktree-created'" }] },
            { matcher: "Bash", hooks: [{ type: "command", command: "other-tool post-bash" }] },
          ],
        },
        model: "gpt-5",
      }),
    )

    await adapter.removeWorktreeWatchHook(file)

    const after = await readFile(file, "utf8")
    expect(after).not.toContain("worktree-created")
    expect(after).toContain("other-tool post-bash")
    expect(after).toContain("gpt-5")

    // Idempotent: a second launch is a no-op, so the file is not even rewritten.
    await adapter.removeWorktreeWatchHook(file)
    expect(await readFile(file, "utf8")).toBe(after)
  })
})
