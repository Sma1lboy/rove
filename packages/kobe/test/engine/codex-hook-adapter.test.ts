import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CodexHookAdapter, KOBE_CODEX_HOOK_EVENTS, codexHooksPath } from "../../src/engine/codex-local/hook-adapter.ts"

// The adapter's install path builds hook commands from `kobeHookInvocation()`
// (whose dev fallback is `kobeCliInvocation()`). Pin the whole module so the
// roundtrip exercises the merge/IO, not CLI-path resolution. NOTE: vi.mock
// replaces EVERY export — a new function
// added to invocation.ts must be stubbed here too, or json-hooks' default-arg
// call becomes undefined() and editJsonSettings' best-effort catch silently
// eats it (that exact gap shipped red CI once).
vi.mock("../../src/cli/invocation.ts", () => ({
  kobeCliInvocation: () => ["kobe"],
  kobeHookInvocation: () => ["kobe"],
}))

describe("CodexHookAdapter", () => {
  const adapter = new CodexHookAdapter()

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
      ["SessionStart", "Stop", "UserPromptSubmit", "PreCompact", "PostCompact", "PreToolUse", "PostToolUse"].sort(),
    )
    // The verbs with no clean Codex signal are NOT installed: no StopFailure
    // equivalent, no Notification, and SessionEnd/Subagent* are documented
    // upstream but absent from the pinned protocol.
    for (const absent of ["StopFailure", "Notification", "SessionEnd", "SubagentStart", "PostToolUseFailure"]) {
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

  it("installs SessionStart/UserPromptSubmit/Stop, preserving the user's hooks", async () => {
    // Seed a user-authored hook that must survive kobe's merge.
    await writeFile(file, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "user-stop" }] }] } }))

    await adapter.installActivityHooks(file)

    const hooks = await readHooks()
    expect(hooks.SessionStart).toBeDefined()
    expect(hooks.UserPromptSubmit).toBeDefined()
    expect(hooks.Stop).toBeDefined()
    // Codex never delivers these → kobe must not install them.
    expect(hooks.StopFailure).toBeUndefined()
    expect(hooks.Notification).toBeUndefined()
    expect(hooks.SessionEnd).toBeUndefined()
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
