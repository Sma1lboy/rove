/**
 * Grok's `hooks/rove.json` merge + install. Grok merges every `*.json` in that
 * directory, so Rove owns one file there rather than editing a shared one —
 * and the file is still a well-behaved merge target, because a user may add
 * their own entry to it. These pin the one-event table, the guard that leaves
 * a machine without grok alone, the subdirectory the guard must NOT check, and
 * the three properties every launch-time installer owes: idempotent,
 * merge-safe, ownership-based.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GROK_HOOK_EVENT_MAP, GrokHookAdapter, grokConfigDir, grokHooksPath } from "@/engine/grok-local/hook-adapter"
import { ROVE_HOOK_VERSION, mergeActivityHooks, roveHookArgs } from "@/engine/json-hooks"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const PROD = ["rove"]
const DEV = ["bun", "/repo/packages/kobe/src/cli/rove.ts"]
const OPTS = { extraArgs: roveHookArgs("grok") }
const INSTALLED = {
  hooks: [{ type: "command", command: `rove hook session-start --engine grok --hook-version ${ROVE_HOOK_VERSION}` }],
}
/** A user's own entry in the same file — grok merges the whole directory, so
 *  someone may well have put one here. */
const FOREIGN = { hooks: [{ type: "command", command: "sh '/Users/x/.grok/hooks/audit.sh' session", timeout: 10 }] }

function merge(doc: Record<string, unknown>, install: boolean, inv = PROD): Record<string, unknown> {
  return mergeActivityHooks(doc, install, GROK_HOOK_EVENT_MAP, inv, OPTS)
}

function sessionStart(doc: Record<string, unknown>): unknown[] {
  return ((doc.hooks as Record<string, unknown>)?.SessionStart ?? []) as unknown[]
}

describe("grok hook merge", () => {
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
            command: `bun /repo/packages/kobe/src/cli/rove.ts hook session-start --engine grok --hook-version ${ROVE_HOOK_VERSION}`,
          },
        ],
      },
    ])
    expect(sessionStart(merge(dev, true))).toEqual([INSTALLED])
  })

  it("preserves a user's own group, other events, and other top-level keys", () => {
    const before = {
      note: "mine",
      hooks: { SessionStart: [FOREIGN], PreToolUse: [{ hooks: [{ type: "command", command: "audit.sh" }] }] },
    }
    const after = merge(before, true)
    expect(sessionStart(after)).toEqual([FOREIGN, INSTALLED])
    expect((after.hooks as Record<string, unknown>).PreToolUse).toEqual([
      { hooks: [{ type: "command", command: "audit.sh" }] },
    ])
    expect(after.note).toBe("mine")
  })

  it("removal takes only Rove's group and drops the event when nothing is left", () => {
    const shared = merge({ hooks: { SessionStart: [FOREIGN] } }, true)
    expect(sessionStart(merge(shared, false))).toEqual([FOREIGN])
    expect(sessionStart(merge(merge({}, true), false))).toEqual([])
  })

  // Grok's other hook events gate its own actions rather than observing them;
  // the screen manifest keeps owning working/blocked.
  it("wires SessionStart and nothing else", () => {
    expect(GROK_HOOK_EVENT_MAP).toEqual([{ event: "SessionStart", verb: "session-start" }])
  })
})

describe("grokHooksPath", () => {
  // `join`, not a literal — the separator is the platform's, and a
  // "/home/x/.grok/…" spelling passes everywhere except the Windows CI job.
  afterEach(() => vi.unstubAllEnvs())

  it("lands in grok's own hooks directory under the default config home", () => {
    vi.stubEnv("GROK_HOME", "")
    expect(grokConfigDir("/home/x")).toBe(join("/home/x", ".grok"))
    expect(grokHooksPath("/home/x")).toBe(join("/home/x", ".grok", "hooks", "rove.json"))
  })

  it("honours the CLI's own GROK_HOME override", () => {
    vi.stubEnv("GROK_HOME", join("/elsewhere", "grok"))
    expect(grokHooksPath("/home/x")).toBe(join("/elsewhere", "grok", "hooks", "rove.json"))
  })
})

describe("GrokHookAdapter install", () => {
  let home: string
  const adapter = new GrokHookAdapter()

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rove-grok-hooks-"))
    vi.stubEnv("ROVE_HOME_DIR", join(home, "rove"))
    vi.stubGlobal("Bun", { which: () => "/usr/local/bin/kobe" })
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("writes nothing at all when grok was never installed here", async () => {
    const file = join(home, ".grok", "hooks", "rove.json")
    expect(await adapter.installActivityHooks(file, { quiet: true })).toEqual({ ok: true })
    expect(existsSync(join(home, ".grok"))).toBe(false)
  })

  // A grok install that has never had a hook has the config home and no
  // `hooks/`. Guarding on the settings file's own parent — the default — would
  // skip this machine forever, which is why the adapter guards one level up.
  it("creates hooks/ under an existing config home", async () => {
    mkdirSync(join(home, ".grok"))
    const file = join(home, ".grok", "hooks", "rove.json")
    expect(await adapter.installActivityHooks(file, { quiet: true })).toEqual({ ok: true })
    expect(readFileSync(file, "utf8")).toContain("hook session-start --engine grok")
  })

  it("a second install is byte-identical", async () => {
    mkdirSync(join(home, ".grok"))
    const file = join(home, ".grok", "hooks", "rove.json")
    await adapter.installActivityHooks(file, { quiet: true })
    const first = readFileSync(file, "utf8")
    await adapter.installActivityHooks(file, { quiet: true })
    expect(readFileSync(file, "utf8")).toBe(first)
  })

  it("keeps a user's own entry around the install and gives it back on removal", async () => {
    mkdirSync(join(home, ".grok", "hooks"), { recursive: true })
    const file = join(home, ".grok", "hooks", "rove.json")
    writeFileSync(file, JSON.stringify({ note: "mine", hooks: { SessionStart: [FOREIGN] } }, null, 2))
    await adapter.installActivityHooks(file, { quiet: true })
    const doc = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
    expect(doc.note).toBe("mine")
    expect(sessionStart(doc)).toHaveLength(2)
    await adapter.removeActivityHooks(file)
    expect(sessionStart(JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>)).toEqual([FOREIGN])
  })

  it("refuses a document it cannot merge into rather than overwriting it", async () => {
    mkdirSync(join(home, ".grok", "hooks"), { recursive: true })
    const file = join(home, ".grok", "hooks", "rove.json")
    writeFileSync(file, '{"hooks": {"SessionStart": "nope"}}')
    const outcome = await adapter.installActivityHooks(file, { quiet: true })
    expect(outcome).toEqual({ ok: false, file, reason: '"hooks.SessionStart" is not an array' })
    expect(readFileSync(file, "utf8")).toBe('{"hooks": {"SessionStart": "nope"}}')
  })
})

describe("GrokHookAdapter payload readers", () => {
  const adapter = new GrokHookAdapter()

  it("reads both spellings of the session id and transcript path", () => {
    expect(adapter.sessionFromPayload({ session_id: "s1" })).toEqual({ sessionId: "s1" })
    expect(adapter.sessionFromPayload({ sessionId: "s2" })).toEqual({ sessionId: "s2" })
    expect(adapter.sessionFromPayload({ session_id: "s1", transcript_path: "/t.jsonl" })).toEqual({
      sessionId: "s1",
      transcriptPath: "/t.jsonl",
    })
  })

  // The id also rides the environment as GROK_SESSION_ID, which this seam
  // cannot see — it does not need to, since the payload carries it. A payload
  // with no id at all stays unidentified rather than invented.
  it("answers nothing rather than guessing when the payload carries no id", () => {
    expect(adapter.sessionFromPayload({})).toBeUndefined()
    expect(adapter.sessionFromPayload({ session_id: "" })).toBeUndefined()
    expect(adapter.sessionFromPayload({ session_id: 7 })).toBeUndefined()
  })
})
