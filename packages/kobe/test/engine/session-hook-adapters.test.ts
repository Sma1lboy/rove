/**
 * Qodercli's and devin's hook install. Both read the NESTED group shape Claude
 * and Codex read, so the merge is the shared one (`engine/json-hooks.ts`) and
 * these pin what each engine adds on top: its own config path (three different
 * derivations, two of them with a vendor env override), the one-event table,
 * the guard that leaves a machine without that CLI alone, and the three
 * properties every launch-time installer owes the user's file — idempotent,
 * merge-safe, ownership-based.
 *
 * Droid is the third engine on this base and has its own file
 * (`droid-hook-adapter.test.ts`), written before the base was extracted.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEVIN_HOOK_EVENT_MAP, DevinHookAdapter, devinSettingsPath } from "@/engine/devin-local/hook-adapter"
import type { EngineHookAdapter } from "@/engine/hook-adapter"
import { ROVE_HOOK_VERSION, mergeActivityHooks, roveHookArgs } from "@/engine/json-hooks"
import type { HookEventSpec } from "@/engine/json-hooks"
import {
  QODERCLI_HOOK_EVENT_MAP,
  QodercliHookAdapter,
  qodercliSettingsPath,
} from "@/engine/qodercli-local/hook-adapter"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const PROD = ["rove"]
const DEV = ["bun", "/repo/packages/kobe/src/cli/rove.ts"]

interface EngineCase {
  readonly vendor: string
  readonly eventMap: readonly HookEventSpec[]
  readonly adapter: () => EngineHookAdapter
  /** Config path relative to a fake home, as path segments. */
  readonly relPath: readonly string[]
  readonly pathFor: (home: string) => string
  /** The engine's own config-dir override, if it has one. */
  readonly envOverride?: { readonly name: string; readonly dirFor: (dir: string) => string }
  /** A third party's entry in the same file, which must survive. */
  readonly foreignCommand: string
}

const CASES: readonly EngineCase[] = [
  {
    vendor: "qodercli",
    eventMap: QODERCLI_HOOK_EVENT_MAP,
    adapter: () => new QodercliHookAdapter(),
    relPath: [".qoder", "settings.json"],
    pathFor: qodercliSettingsPath,
    envOverride: { name: "QODERCLI_CONFIG_DIR", dirFor: (dir) => dir },
    foreignCommand: "'/Users/x/.qoder/hooks/peer-agent-state.sh' session",
  },
  {
    vendor: "devin",
    eventMap: DEVIN_HOOK_EVENT_MAP,
    adapter: () => new DevinHookAdapter(),
    relPath: [".config", "devin", "config.json"],
    pathFor: devinSettingsPath,
    // XDG_CONFIG_HOME names the directory ABOVE `devin/`, unlike the vendor
    // overrides that name the config dir itself.
    envOverride: { name: "XDG_CONFIG_HOME", dirFor: (dir) => join(dir, "devin") },
    foreignCommand: "'/Users/x/.config/devin/peer-agent-state.sh' session",
  },
]

describe.each(CASES)("$vendor hooks", (c) => {
  const installedCommand = `rove hook session-start --engine ${c.vendor} --hook-version ${ROVE_HOOK_VERSION}`
  const opts = { extraArgs: roveHookArgs(c.vendor) }
  const foreign = { hooks: [{ type: "command", command: c.foreignCommand, timeout: 10 }] }

  function merge(doc: Record<string, unknown>, install: boolean, inv = PROD): Record<string, unknown> {
    return mergeActivityHooks(doc, install, c.eventMap, inv, opts)
  }
  function sessionStart(doc: Record<string, unknown>): unknown[] {
    return ((doc.hooks as Record<string, unknown>)?.SessionStart ?? []) as unknown[]
  }
  /** What the merge writes, matcher and all — qodercli takes the `"*"`
   *  wildcard its schema expects, devin takes none. */
  function installed(): Record<string, unknown> {
    const matcher = c.eventMap[0]?.matcher
    return { ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: installedCommand }] }
  }

  it("wires SessionStart and nothing else", () => {
    expect(c.eventMap.map((spec) => ({ event: spec.event, verb: spec.verb }))).toEqual([
      { event: "SessionStart", verb: "session-start" },
    ])
  })

  it("installs one SessionStart group into an empty document, stamped", () => {
    expect(sessionStart(merge({}, true))).toEqual([installed()])
  })

  it("is idempotent — a second install replaces rather than appends", () => {
    const once = merge({}, true)
    expect(merge(once, true)).toEqual(once)
    expect(sessionStart(merge(once, true))).toHaveLength(1)
  })

  it("replaces a dev-checkout install with the released one instead of stacking", () => {
    const dev = merge({}, true, DEV)
    expect(JSON.stringify(dev)).toContain(
      `bun /repo/packages/kobe/src/cli/rove.ts hook session-start --engine ${c.vendor}`,
    )
    expect(sessionStart(merge(dev, true))).toEqual([installed()])
  })

  it("preserves a third party's group, other events, and other top-level keys", () => {
    const before = {
      theme: "dark",
      hooks: { SessionStart: [foreign], PreToolUse: [{ hooks: [{ type: "command", command: "audit.sh" }] }] },
    }
    const after = merge(before, true)
    expect(sessionStart(after)).toEqual([foreign, installed()])
    expect((after.hooks as Record<string, unknown>).PreToolUse).toEqual([
      { hooks: [{ type: "command", command: "audit.sh" }] },
    ])
    expect(after.theme).toBe("dark")
  })

  it("removal takes only Rove's group and drops the event when nothing is left", () => {
    const shared = merge({ hooks: { SessionStart: [foreign] } }, true)
    expect(sessionStart(merge(shared, false))).toEqual([foreign])
    expect(sessionStart(merge(merge({}, true), false))).toEqual([])
  })

  describe("config path", () => {
    afterEach(() => vi.unstubAllEnvs())

    // `join`, not a literal: the separator is the platform's, and a
    // "/home/x/.qoder/settings.json" spelling passes everywhere but Windows CI.
    it("defaults under the home directory", () => {
      if (c.envOverride) vi.stubEnv(c.envOverride.name, "")
      expect(c.pathFor("/home/x")).toBe(join("/home/x", ...c.relPath))
    })

    it("honours the engine's own config-dir override", () => {
      const override = c.envOverride
      if (!override) return
      vi.stubEnv(override.name, join("/elsewhere", "cfg"))
      expect(c.pathFor("/home/x")).toBe(join(override.dirFor(join("/elsewhere", "cfg")), c.relPath.at(-1) as string))
    })
  })

  describe("install", () => {
    let home: string
    const adapter = c.adapter()

    beforeEach(() => {
      home = mkdtempSync(join(tmpdir(), `rove-${c.vendor}-hooks-`))
      // The merge's lock file belongs in a throwaway state dir, not the
      // developer's real ~/.rove; and `kobeHookInvocation` probes PATH through
      // a bare `Bun.which`, which does not exist under vitest's node.
      vi.stubEnv("ROVE_HOME_DIR", join(home, "rove"))
      vi.stubGlobal("Bun", { which: () => "/usr/local/bin/kobe" })
    })
    afterEach(() => {
      rmSync(home, { recursive: true, force: true })
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    })

    function configDir(): string {
      return join(home, ...c.relPath.slice(0, -1))
    }

    it("writes nothing at all when the CLI was never installed here", async () => {
      const file = join(home, ...c.relPath)
      expect(await adapter.installActivityHooks(file, { quiet: true })).toEqual({ ok: true })
      expect(existsSync(join(home, c.relPath[0] as string))).toBe(false)
    })

    it("installs into an existing config dir and a second run is byte-identical", async () => {
      mkdirSync(configDir(), { recursive: true })
      const file = join(home, ...c.relPath)
      expect(await adapter.installActivityHooks(file, { quiet: true })).toEqual({ ok: true })
      const first = readFileSync(file, "utf8")
      expect(first).toContain(`hook session-start --engine ${c.vendor}`)
      expect(await adapter.installActivityHooks(file, { quiet: true })).toEqual({ ok: true })
      expect(readFileSync(file, "utf8")).toBe(first)
    })

    it("keeps the user's own settings around install and removal", async () => {
      mkdirSync(configDir(), { recursive: true })
      const file = join(home, ...c.relPath)
      writeFileSync(file, JSON.stringify({ theme: "dark", hooks: { SessionStart: [foreign] } }, null, 2))
      await adapter.installActivityHooks(file, { quiet: true })
      const doc = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
      expect(doc.theme).toBe("dark")
      expect(sessionStart(doc)).toHaveLength(2)
      await adapter.removeActivityHooks(file)
      expect(sessionStart(JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>)).toEqual([foreign])
    })

    it("refuses a document it cannot merge into rather than overwriting it", async () => {
      mkdirSync(configDir(), { recursive: true })
      const file = join(home, ...c.relPath)
      const raw = '{"hooks": {"SessionStart": "nope"}}'
      writeFileSync(file, raw)
      expect(await adapter.installActivityHooks(file, { quiet: true })).toEqual({
        ok: false,
        file,
        reason: '"hooks.SessionStart" is not an array',
      })
      expect(readFileSync(file, "utf8")).toBe(raw)
      // doctor reads the same verdict off the same bytes, and this engine's
      // own valid document is NOT reported as broken.
      expect(adapter.hookConfigRefusal?.(raw)).toBe('"hooks.SessionStart" is not an array')
      expect(adapter.hookConfigRefusal?.(JSON.stringify(merge({}, true)))).toBeUndefined()
    })
  })

  describe("payload readers", () => {
    const adapter = c.adapter()

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
})
