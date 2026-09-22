/**
 * MastraCode's `~/.mastracode/hooks.json` merge + install. The file uses the
 * FLAT entry shape cursor and Copilot use, so the merge itself is the shared
 * one (`engine/flat-hooks.ts`) and these pin what MastraCode adds on top: the
 * full-lifecycle table (it is the only engine here whose hooks own the badge
 * outright), the guard that leaves a machine without the CLI alone, and the
 * three properties every launch-time installer owes the user's file.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ROVE_HOOK_VERSION } from "@/engine/json-hooks"
import {
  MASTRACODE_HOOK_EVENT_MAP,
  MastracodeHookAdapter,
  mastracodeHooksPath,
  mergeMastracodeHooks,
  parseMastracodeHooks,
} from "@/engine/mastracode-local/hook-adapter"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const PROD = ["rove"]
const DEV = ["bun", "/repo/packages/kobe/src/cli/rove.ts"]
/** A user's own entry in the same file. */
const FOREIGN = { type: "command", command: "bash '/Users/x/.mastracode/hooks/audit.sh' working", timeout: 10000 }

function entries(doc: Record<string, unknown>, event: string): unknown[] {
  return ((doc.hooks as Record<string, unknown>)?.[event] ?? []) as unknown[]
}

function installed(verb: string): Record<string, string> {
  return { type: "command", command: `rove hook ${verb} --engine mastracode --hook-version ${ROVE_HOOK_VERSION}` }
}

describe("mergeMastracodeHooks", () => {
  it("installs one flat entry per declared event, stamped with the version", () => {
    const doc = mergeMastracodeHooks({}, true, PROD)
    expect(doc.version).toBe(1)
    expect(entries(doc, "SessionStart")).toEqual([installed("session-start")])
    expect(entries(doc, "PermissionRequest")).toEqual([installed("awaiting-input")])
    expect(entries(doc, "AgentEnd")).toEqual([installed("turn-complete")])
    expect(entries(doc, "Interrupt")).toEqual([installed("turn-interrupted")])
  })

  it("is idempotent — a second install replaces rather than appends", () => {
    const once = mergeMastracodeHooks({}, true, PROD)
    const twice = mergeMastracodeHooks(once, true, PROD)
    expect(twice).toEqual(once)
    expect(entries(twice, "AgentStart")).toHaveLength(1)
  })

  it("replaces a dev-checkout install with the released one instead of stacking", () => {
    const dev = mergeMastracodeHooks({}, true, DEV)
    expect(entries(dev, "SessionStart")).toEqual([
      {
        type: "command",
        command: `bun /repo/packages/kobe/src/cli/rove.ts hook session-start --engine mastracode --hook-version ${ROVE_HOOK_VERSION}`,
      },
    ])
    expect(entries(mergeMastracodeHooks(dev, true, PROD), "SessionStart")).toEqual([installed("session-start")])
  })

  it("preserves a user's own entry, other events, and other top-level keys", () => {
    const before = {
      version: 1,
      model: "gpt-5",
      hooks: { SessionStart: [FOREIGN], PreToolUse: [{ type: "command", command: "audit.sh" }] },
    }
    const after = mergeMastracodeHooks(before, true, PROD)
    expect(entries(after, "SessionStart")).toEqual([FOREIGN, installed("session-start")])
    // PreToolUse is deliberately unhooked, so the user's entry there is left
    // completely alone rather than merged into.
    expect(entries(after, "PreToolUse")).toEqual([{ type: "command", command: "audit.sh" }])
    expect(after.model).toBe("gpt-5")
  })

  it("removal takes only Rove's entries and drops each event when nothing is left", () => {
    const shared = mergeMastracodeHooks({ hooks: { SessionStart: [FOREIGN] } }, true, PROD)
    expect(entries(mergeMastracodeHooks(shared, false, PROD), "SessionStart")).toEqual([FOREIGN])
    const ours = mergeMastracodeHooks({}, true, PROD)
    const removed = mergeMastracodeHooks(ours, false, PROD)
    expect((removed.hooks as Record<string, unknown>).SessionStart).toBeUndefined()
    expect((removed.hooks as Record<string, unknown>).Stop).toBeUndefined()
  })

  // PreToolUse and the subagent pair are the CLI's high-frequency events: each
  // fire is a process spawn, and all three would only re-assert "running",
  // which AgentStart already said.
  it("wires the state-changing events and skips the per-tool-call ones", () => {
    const events = MASTRACODE_HOOK_EVENT_MAP.map((spec) => spec.event)
    expect(events).toEqual([
      "SessionStart",
      "UserPromptSubmit",
      "AgentStart",
      "PermissionRequest",
      "PermissionResult",
      "Interrupt",
      "AgentEnd",
      "Stop",
    ])
    expect(events).not.toContain("PreToolUse")
    expect(events).not.toContain("SubagentStart")
    expect(events).not.toContain("SubagentEnd")
  })
})

describe("parseMastracodeHooks", () => {
  it("accepts a missing file, a hookless document, and the CLI's own shape", () => {
    expect(parseMastracodeHooks(undefined)).toEqual({ ok: true, doc: {} })
    expect(parseMastracodeHooks('{"version":1}')).toEqual({ ok: true, doc: { version: 1 } })
    expect(parseMastracodeHooks('{"hooks":{"SessionStart":[{"type":"command","command":"x"}]}}').ok).toBe(true)
  })

  it("refuses what it cannot merge into, with a reason naming the path", () => {
    expect(parseMastracodeHooks("{oops")).toMatchObject({ ok: false })
    expect(parseMastracodeHooks("[]")).toEqual({ ok: false, reason: "top level is not a JSON object" })
    expect(parseMastracodeHooks('{"hooks":{"Stop":"nope"}}')).toEqual({
      ok: false,
      reason: '"hooks.Stop" is not an array',
    })
  })
})

describe("mastracodeHooksPath", () => {
  // `join`, not a literal — the separator is the platform's.
  it("is ~/.mastracode/hooks.json, with no env override", () => {
    expect(mastracodeHooksPath("/home/x")).toBe(join("/home/x", ".mastracode", "hooks.json"))
  })
})

describe("MastracodeHookAdapter install", () => {
  let home: string
  const adapter = new MastracodeHookAdapter()

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rove-mastracode-"))
    vi.stubEnv("ROVE_HOME_DIR", join(home, "rove"))
    vi.stubGlobal("Bun", { which: () => "/usr/local/bin/kobe" })
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("writes nothing at all when the CLI was never installed here", async () => {
    const file = join(home, ".mastracode", "hooks.json")
    expect(await adapter.installActivityHooks(file, { quiet: true })).toEqual({ ok: true })
    expect(existsSync(join(home, ".mastracode"))).toBe(false)
  })

  it("installs into an existing config dir and a second run is byte-identical", async () => {
    mkdirSync(join(home, ".mastracode"))
    const file = join(home, ".mastracode", "hooks.json")
    expect(await adapter.installActivityHooks(file, { quiet: true })).toEqual({ ok: true })
    const first = readFileSync(file, "utf8")
    expect(first).toContain("hook session-start --engine mastracode")
    await adapter.installActivityHooks(file, { quiet: true })
    expect(readFileSync(file, "utf8")).toBe(first)
  })

  it("keeps the user's own entry around the install and gives it back on removal", async () => {
    mkdirSync(join(home, ".mastracode"))
    const file = join(home, ".mastracode", "hooks.json")
    writeFileSync(file, JSON.stringify({ version: 1, hooks: { SessionStart: [FOREIGN] } }, null, 2))
    await adapter.installActivityHooks(file, { quiet: true })
    expect(entries(JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>, "SessionStart")).toHaveLength(2)
    await adapter.removeActivityHooks(file)
    expect(entries(JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>, "SessionStart")).toEqual([
      FOREIGN,
    ])
  })

  it("refuses a document it cannot merge into rather than overwriting it", async () => {
    mkdirSync(join(home, ".mastracode"))
    const file = join(home, ".mastracode", "hooks.json")
    writeFileSync(file, '{"hooks": {"Stop": "nope"}}')
    const outcome = await adapter.installActivityHooks(file, { quiet: true })
    expect(outcome).toEqual({ ok: false, file, reason: '"hooks.Stop" is not an array' })
    expect(readFileSync(file, "utf8")).toBe('{"hooks": {"Stop": "nope"}}')
    expect(adapter.hookConfigRefusal('{"hooks": {"Stop": "nope"}}')).toBe('"hooks.Stop" is not an array')
  })
})

describe("MastracodeHookAdapter payload readers", () => {
  const adapter = new MastracodeHookAdapter()

  it("names the permission wait and leaves the other verbs undetailed", () => {
    expect(adapter.activityDetailFromPayload("awaiting-input")).toEqual({ waiting: "permission" })
    expect(adapter.activityDetailFromPayload("turn-complete")).toBeUndefined()
  })

  it("takes the session id and omits an absent transcript path", () => {
    expect(adapter.sessionFromPayload({ session_id: "s1" })).toEqual({ sessionId: "s1" })
    expect(adapter.sessionFromPayload({ session_id: "s1", transcript_path: "/t.jsonl" })).toEqual({
      sessionId: "s1",
      transcriptPath: "/t.jsonl",
    })
    expect(adapter.sessionFromPayload({})).toBeUndefined()
    expect(adapter.sessionFromPayload({ session_id: "" })).toBeUndefined()
  })
})
