import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ROVE_HOOK_VERSION } from "@/engine/json-hooks"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  KOBE_KIMI_HOOK_EVENTS,
  KimiHookAdapter,
  mergeKimiHooks,
  removeKimiHookBlock,
  renderKimiHookBlock,
} from "../../src/engine/kimi-local/hook-adapter.ts"

// Pin the CLI invocation module whole (same rule as codex-hook-adapter.test:
// vi.mock replaces EVERY export; a new invocation.ts function must be stubbed
// here too or default-arg calls become undefined()).
vi.mock("../../src/cli/invocation.ts", () => ({
  roveCliInvocation: () => ["kobe"],
  kobeHookInvocation: () => ["kobe"],
}))

describe("KimiHookAdapter", () => {
  const adapter = new KimiHookAdapter()

  it("wires the load-bearing Kimi events and keeps Notification out", () => {
    // Interrupt is the load-bearing one: Kimi fires it INSTEAD of Stop on a
    // user interrupt (plugin-events.md §B).
    for (const wired of ["SessionStart", "UserPromptSubmit", "Stop", "StopFailure", "Interrupt", "PermissionRequest"]) {
      expect(KOBE_KIMI_HOOK_EVENTS).toContain(wired)
    }
    // Notification stays out: no documented type filter → every idle prompt
    // would read as needs-input.
    expect(KOBE_KIMI_HOOK_EVENTS).not.toContain("Notification")
  })

  it("classifies PermissionRequest as a permission wait and reads tool names", () => {
    expect(adapter.activityDetailFromPayload("awaiting-input", {})).toEqual({ waiting: "permission" })
    expect(adapter.activityDetailFromPayload("tool-pre", { tool_name: "Bash" })).toEqual({ tool: { name: "Bash" } })
    expect(adapter.activityDetailFromPayload("turn-complete", {})).toBeUndefined()
  })

  it("extracts session identity from the stdin payload", () => {
    expect(adapter.sessionFromPayload({ session_id: "s1" })).toEqual({ sessionId: "s1" })
    expect(adapter.sessionFromPayload({})).toBeUndefined()
  })
})

describe("mergeKimiHooks (pure TOML block merge)", () => {
  const inv = ["kobe"] as const

  it("appends a marker-delimited block with one table per non-gated event", () => {
    const out = mergeKimiHooks("", true, inv)
    expect(out).toContain("# >>> rove hooks")
    expect(out).toContain("# <<< rove hooks")
    expect(out).toContain('event = "Interrupt"')
    expect(out).toContain(`command = "kobe hook turn-interrupted --engine kimi --hook-version ${ROVE_HOOK_VERSION}"`)
    // Gated tool family is absent by default…
    expect(out).not.toContain('event = "PreToolUse"')
    // …and present when a plugin subscribes tool.* events.
    expect(mergeKimiHooks("", true, inv, { toolEvents: true })).toContain('event = "PreToolUse"')
  })

  it("preserves the user's config outside the block, byte-for-byte", () => {
    const user = 'default_model = "kimi-code/k3"\n\n[thinking]\nenabled = true\n'
    const installed = mergeKimiHooks(user, true, inv)
    expect(installed.startsWith('default_model = "kimi-code/k3"')).toBe(true)
    expect(removeKimiHookBlock(installed)).toContain("[thinking]")
    // remove → exactly the user's content again (modulo trailing whitespace)
    expect(mergeKimiHooks(installed, false, inv).trim()).toBe(user.trim())
  })

  it("keeps the user's own [[hooks]] tables (only the marker block is owned)", () => {
    const user = '[[hooks]]\nevent = "Stop"\ncommand = "my-own-hook"\n'
    const installed = mergeKimiHooks(user, true, inv)
    expect(installed).toContain('command = "my-own-hook"')
    const removed = mergeKimiHooks(installed, false, inv)
    expect(removed).toContain('command = "my-own-hook"')
    expect(removed).not.toContain("# >>> rove hooks")
  })
})

describe("KimiHookAdapter install/remove roundtrip (real file)", () => {
  let dir: string
  let file: string
  const adapter = new KimiHookAdapter()

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kobe-kimi-hooks-"))
    file = join(dir, "config.toml")
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("creates a missing config.toml inside an existing kimi dir", async () => {
    await adapter.installActivityHooks(file)
    const text = await readFile(file, "utf8")
    expect(text).toContain('event = "SessionStart"')
    expect(text).toContain('event = "Interrupt"')
  })

  it("skips entirely when the kimi config dir does not exist", async () => {
    const missing = join(dir, "no-such-dir", "config.toml")
    await adapter.installActivityHooks(missing)
    await expect(readFile(missing, "utf8")).rejects.toThrow()
  })

  it("reinstall on an already-installed file skips the write (mtime stable)", async () => {
    await adapter.installActivityHooks(file)
    const before = await readFile(file, "utf8")
    await adapter.installActivityHooks(file)
    expect(await readFile(file, "utf8")).toBe(before)
  })
})

describe("renderKimiHookBlock", () => {
  it("bounds every hook with an explicit sub-30s timeout", () => {
    const block = renderKimiHookBlock(["kobe"])
    const tables = block.split("[[hooks]]").length - 1
    const timeouts = block.split("timeout = 10").length - 1
    expect(tables).toBeGreaterThan(0)
    expect(timeouts).toBe(tables)
  })
})
