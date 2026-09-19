/**
 * Copilot's settings.json merge + install. Copilot reads the FLAT entry shape
 * (`{ type, command }` directly under the event) that cursor reads, not the
 * nested groups Claude and Codex read, so these pin the four properties a
 * best-effort installer that runs on EVERY launch has to hold: it is
 * idempotent, it never touches somebody else's entry, it recognizes its own by
 * OWNERSHIP rather than literal text, and it leaves a machine without copilot
 * completely alone.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  COPILOT_HOOK_EVENT_MAP,
  CopilotHookAdapter,
  copilotSettingsPath,
  mergeCopilotHooks,
} from "@/engine/copilot-local/hook-adapter"
import { ROVE_HOOK_VERSION } from "@/engine/json-hooks"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const PROD = ["rove"]
const DEV = ["bun", "/repo/packages/kobe/src/cli/rove.ts"]
const INSTALLED = {
  type: "command",
  command: `rove hook session-start --engine copilot --hook-version ${ROVE_HOOK_VERSION}`,
}
/** A third party's entry in the same file, whose command lives in `bash`
 *  rather than `command`. */
const FOREIGN = { type: "command", bash: "'/Users/x/.copilot/hooks/peer-agent-state.sh'", timeoutSec: 10 }

function sessionStart(doc: Record<string, unknown>): unknown[] {
  return ((doc.hooks as Record<string, unknown>).SessionStart ?? []) as unknown[]
}

describe("mergeCopilotHooks", () => {
  it("installs one SessionStart entry into an empty document, typed and stamped", () => {
    const doc = mergeCopilotHooks({}, true, PROD)
    // Two versions on this row and they are different things: `doc.version` is
    // copilot's file-schema marker, `--hook-version` is which shape of Rove
    // wrote the entry (`engine/integration-status.ts` reads it back).
    expect(doc.version).toBe(1)
    expect(sessionStart(doc)).toEqual([INSTALLED])
  })

  it("is idempotent — a second install replaces rather than appends", () => {
    const once = mergeCopilotHooks({}, true, PROD)
    const twice = mergeCopilotHooks(once, true, PROD)
    expect(twice).toEqual(once)
    expect(sessionStart(twice)).toHaveLength(1)
  })

  it("replaces a dev-checkout install with the released one instead of stacking", () => {
    const dev = mergeCopilotHooks({}, true, DEV)
    expect(sessionStart(dev)).toEqual([
      {
        type: "command",
        command: `bun /repo/packages/kobe/src/cli/rove.ts hook session-start --engine copilot --hook-version ${ROVE_HOOK_VERSION}`,
      },
    ])
    expect(sessionStart(mergeCopilotHooks(dev, true, PROD))).toEqual([INSTALLED])
  })

  it("preserves a third party's entry, other events, and other top-level keys", () => {
    const before = {
      version: 1,
      disableAllHooks: false,
      hooks: { SessionStart: [FOREIGN], preToolUse: [{ type: "command", bash: "audit.sh" }] },
    }
    const after = mergeCopilotHooks(before, true, PROD)
    expect(sessionStart(after)).toEqual([FOREIGN, INSTALLED])
    expect((after.hooks as Record<string, unknown>).preToolUse).toEqual([{ type: "command", bash: "audit.sh" }])
    expect(after.disableAllHooks).toBe(false)
  })

  it("removal takes only Rove's entry and drops the event when nothing is left", () => {
    const shared = mergeCopilotHooks({ hooks: { SessionStart: [FOREIGN] } }, true, PROD)
    expect(sessionStart(mergeCopilotHooks(shared, false, PROD))).toEqual([FOREIGN])
    const ours = mergeCopilotHooks({}, true, PROD)
    expect((mergeCopilotHooks(ours, false, PROD).hooks as Record<string, unknown>).SessionStart).toBeUndefined()
  })

  // Copilot's remaining events (userPromptSubmitted, preToolUse, postToolUse,
  // agentStop, …) stay unhooked: the screen manifest keeps owning copilot's
  // working/blocked state, and none of the nine is a verified authority for
  // turn state.
  it("wires SessionStart and nothing else", () => {
    expect(COPILOT_HOOK_EVENT_MAP).toEqual([{ event: "SessionStart", verb: "session-start" }])
  })
})

describe("copilotSettingsPath", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("honours copilot's own COPILOT_HOME override", () => {
    vi.stubEnv("COPILOT_HOME", join("/elsewhere", "copilot"))
    expect(copilotSettingsPath()).toBe(join("/elsewhere", "copilot", "settings.json"))
  })
})

describe("CopilotHookAdapter install", () => {
  let home: string
  const adapter = new CopilotHookAdapter()

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rove-copilot-hooks-"))
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

  it("writes nothing at all when copilot was never installed here", async () => {
    const file = join(home, ".copilot", "settings.json")
    expect(await adapter.installActivityHooks(file, { quiet: true })).toEqual({ ok: true })
    expect(existsSync(join(home, ".copilot"))).toBe(false)
  })

  it("installs into an existing config dir and a second run is byte-identical", async () => {
    const dir = join(home, ".copilot")
    mkdirSync(dir)
    const file = join(dir, "settings.json")
    expect(await adapter.installActivityHooks(file, { quiet: true })).toEqual({ ok: true })
    const first = readFileSync(file, "utf8")
    expect(first).toContain("hook session-start --engine copilot")
    expect(await adapter.installActivityHooks(file, { quiet: true })).toEqual({ ok: true })
    expect(readFileSync(file, "utf8")).toBe(first)
  })

  it("refuses a document it cannot merge into rather than overwriting it", async () => {
    const dir = join(home, ".copilot")
    mkdirSync(dir)
    const file = join(dir, "settings.json")
    writeFileSync(file, '{"hooks": []}')
    const outcome = await adapter.installActivityHooks(file, { quiet: true })
    expect(outcome).toEqual({ ok: false, file, reason: '"hooks" is not an object' })
    expect(readFileSync(file, "utf8")).toBe('{"hooks": []}')
    // doctor reads the same verdict off the same bytes.
    expect(adapter.hookConfigRefusal('{"hooks": []}')).toBe('"hooks" is not an object')
    // …and copilot's own valid shape is NOT reported as broken (what running
    // the Claude/Codex validator over every `.json` hook file used to do).
    expect(adapter.hookConfigRefusal(JSON.stringify(mergeCopilotHooks({}, true, PROD)))).toBeUndefined()
  })
})

describe("CopilotHookAdapter payload readers", () => {
  const adapter = new CopilotHookAdapter()

  it("takes the session id under either spelling", () => {
    expect(adapter.sessionFromPayload({ session_id: "s1", hook_event_name: "SessionStart" })).toEqual({
      sessionId: "s1",
    })
    expect(adapter.sessionFromPayload({ sessionId: "s2" })).toEqual({ sessionId: "s2" })
  })

  it("answers nothing rather than guessing when there is no id", () => {
    expect(adapter.sessionFromPayload({})).toBeUndefined()
    expect(adapter.sessionFromPayload({ session_id: "" })).toBeUndefined()
    expect(adapter.sessionFromPayload({ session_id: 7 })).toBeUndefined()
  })
})
