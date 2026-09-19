/**
 * Droid's `~/.factory/settings.json` merge + install. Droid reads the NESTED
 * group shape Claude and Codex read, so the merge itself is the shared one
 * (`engine/json-hooks.ts`) and these tests pin what droid adds on top: the
 * one-event table, the guard that leaves a machine without droid alone, and
 * the three properties every launch-time installer owes the user's file —
 * idempotent, merge-safe, ownership-based.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DROID_HOOK_EVENT_MAP, DroidHookAdapter, droidSettingsPath } from "@/engine/droid-local/hook-adapter"
import { ROVE_HOOK_VERSION, mergeActivityHooks, roveHookArgs } from "@/engine/json-hooks"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const PROD = ["rove"]
const DEV = ["bun", "/repo/packages/kobe/src/cli/rove.ts"]
const OPTS = { extraArgs: roveHookArgs("droid") }
const INSTALLED = {
  hooks: [{ type: "command", command: `rove hook session-start --engine droid --hook-version ${ROVE_HOOK_VERSION}` }],
}
/** What herdr's own integration leaves in the same file. */
const FOREIGN = {
  hooks: [{ type: "command", command: "'/Users/x/.factory/hooks/herdr-agent-state.sh' session", timeout: 10 }],
}

function merge(doc: Record<string, unknown>, install: boolean, inv = PROD): Record<string, unknown> {
  return mergeActivityHooks(doc, install, DROID_HOOK_EVENT_MAP, inv, OPTS)
}

function sessionStart(doc: Record<string, unknown>): unknown[] {
  return ((doc.hooks as Record<string, unknown>)?.SessionStart ?? []) as unknown[]
}

describe("droid hook merge", () => {
  it("installs one SessionStart group into an empty document, stamped", () => {
    expect(sessionStart(merge({}, true))).toEqual([INSTALLED])
  })

  it("is idempotent — a second install replaces rather than appends", () => {
    const once = merge({}, true)
    expect(merge(once, true)).toEqual(once)
    expect(sessionStart(merge(once, true))).toHaveLength(1)
  })

  it("replaces a dev-checkout install with the released one instead of stacking", () => {
    const dev = merge({}, true, DEV)
    expect(sessionStart(dev)).toEqual([
      {
        hooks: [
          {
            type: "command",
            command: `bun /repo/packages/kobe/src/cli/rove.ts hook session-start --engine droid --hook-version ${ROVE_HOOK_VERSION}`,
          },
        ],
      },
    ])
    expect(sessionStart(merge(dev, true))).toEqual([INSTALLED])
  })

  it("preserves a third party's group, other events, and other top-level keys", () => {
    const before = {
      model: "claude-sonnet",
      hooks: { SessionStart: [FOREIGN], PreToolUse: [{ hooks: [{ type: "command", command: "audit.sh" }] }] },
    }
    const after = merge(before, true)
    expect(sessionStart(after)).toEqual([FOREIGN, INSTALLED])
    expect((after.hooks as Record<string, unknown>).PreToolUse).toEqual([
      { hooks: [{ type: "command", command: "audit.sh" }] },
    ])
    expect(after.model).toBe("claude-sonnet")
  })

  it("removal takes only Rove's group and drops the event when nothing is left", () => {
    const shared = merge({ hooks: { SessionStart: [FOREIGN] } }, true)
    expect(sessionStart(merge(shared, false))).toEqual([FOREIGN])
    expect(sessionStart(merge(merge({}, true), false))).toEqual([])
  })

  // Droid's other events (UserPromptSubmit, PreToolUse, Notification, Stop,
  // SessionEnd, …) stay unhooked: the screen manifest keeps owning droid's
  // working/blocked state, and herdr — which once installed all nine — now
  // deletes them on sight.
  it("wires SessionStart and nothing else", () => {
    expect(DROID_HOOK_EVENT_MAP).toEqual([{ event: "SessionStart", verb: "session-start" }])
  })
})

describe("droidSettingsPath", () => {
  // `join`, not a literal: the separator is the platform's, and a
  // "/home/x/.factory/settings.json" spelling passes everywhere but Windows CI.
  it("is ~/.factory/settings.json, with no env override", () => {
    expect(droidSettingsPath("/home/x")).toBe(join("/home/x", ".factory", "settings.json"))
  })
})

describe("DroidHookAdapter install", () => {
  let home: string
  const adapter = new DroidHookAdapter()

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rove-droid-hooks-"))
    // The merge's lock file belongs in a throwaway state dir, not the
    // developer's real ~/.rove; and `kobeHookInvocation` probes PATH through a
    // bare `Bun.which`, which does not exist under vitest's node.
    vi.stubEnv("ROVE_HOME_DIR", join(home, "rove"))
    vi.stubGlobal("Bun", { which: () => "/usr/local/bin/kobe" })
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("writes nothing at all when droid was never installed here", async () => {
    const file = join(home, ".factory", "settings.json")
    expect(await adapter.installActivityHooks(file, { quiet: true })).toEqual({ ok: true })
    expect(existsSync(join(home, ".factory"))).toBe(false)
  })

  it("installs into an existing config dir and a second run is byte-identical", async () => {
    const dir = join(home, ".factory")
    mkdirSync(dir)
    const file = join(dir, "settings.json")
    expect(await adapter.installActivityHooks(file, { quiet: true })).toEqual({ ok: true })
    const first = readFileSync(file, "utf8")
    expect(first).toContain("hook session-start --engine droid")
    expect(await adapter.installActivityHooks(file, { quiet: true })).toEqual({ ok: true })
    expect(readFileSync(file, "utf8")).toBe(first)
  })

  it("keeps the user's own droid settings around the install", async () => {
    const dir = join(home, ".factory")
    mkdirSync(dir)
    const file = join(dir, "settings.json")
    writeFileSync(file, JSON.stringify({ model: "gpt-5", hooks: { SessionStart: [FOREIGN] } }, null, 2))
    await adapter.installActivityHooks(file, { quiet: true })
    const doc = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
    expect(doc.model).toBe("gpt-5")
    expect(sessionStart(doc)).toHaveLength(2)
    await adapter.removeActivityHooks(file)
    expect(sessionStart(JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>)).toEqual([FOREIGN])
  })

  it("refuses a document it cannot merge into rather than overwriting it", async () => {
    const dir = join(home, ".factory")
    mkdirSync(dir)
    const file = join(dir, "settings.json")
    writeFileSync(file, '{"hooks": {"SessionStart": "nope"}}')
    const outcome = await adapter.installActivityHooks(file, { quiet: true })
    expect(outcome).toEqual({ ok: false, file, reason: '"hooks.SessionStart" is not an array' })
    expect(readFileSync(file, "utf8")).toBe('{"hooks": {"SessionStart": "nope"}}')
    expect(adapter.hookConfigRefusal('{"hooks": {"SessionStart": "nope"}}')).toBe(
      '"hooks.SessionStart" is not an array',
    )
  })
})

describe("DroidHookAdapter payload readers", () => {
  const adapter = new DroidHookAdapter()

  it("takes the session id and omits an absent transcript path", () => {
    expect(adapter.sessionFromPayload({ session_id: "s1", hook_event_name: "SessionStart" })).toEqual({
      sessionId: "s1",
    })
    expect(adapter.sessionFromPayload({ session_id: "s1", transcript_path: "/t.jsonl" })).toEqual({
      sessionId: "s1",
      transcriptPath: "/t.jsonl",
    })
  })

  it("answers nothing rather than guessing when there is no id", () => {
    expect(adapter.sessionFromPayload({})).toBeUndefined()
    expect(adapter.sessionFromPayload({ session_id: "" })).toBeUndefined()
    expect(adapter.sessionFromPayload({ sessionId: "camel" })).toBeUndefined()
  })
})
