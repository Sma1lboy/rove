/**
 * The OpenCode-family plugin (opencode + kilo): the generated module's
 * BEHAVIOUR, the install, and the two paths that differ between the vendors.
 *
 * The plugin is a build artifact, so it is driven the way the CLIs drive it —
 * evaluate the rendered source, hand its export the plugin input, fire events
 * at it, and assert on the SPAWNED ARGV rather than on the source text. That is
 * the difference between "the file says turn-start" and "the engine reports
 * turn-start".
 *
 * Evaluated with `new Function` rather than imported from a temp file: Vite
 * will not serve a file outside the project root, which is what a temp-dir
 * import is. Two edits make the module body evaluatable — the static import is
 * dropped in favour of an injected `spawn`, and the single `export` keyword is
 * stripped. Nothing else is rewritten, so what runs here is the shipped bytes.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ROVE_HOOK_VERSION } from "@/engine/json-hooks"
import {
  OpencodeFamilyHookAdapter,
  opencodeFamilyConfigDir,
  opencodeFamilyPluginPath,
} from "@/engine/opencode-local/hook-adapter"
import { renderOpencodePluginSource } from "@/engine/opencode-local/plugin-source"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const INVOCATION = ["rove"]

interface SpawnCall {
  readonly command: string
  readonly args: readonly string[]
}

interface Hooks {
  "chat.message"(input: { sessionID?: string }): Promise<void>
  event(input: { event: unknown }): Promise<void>
}

async function loadPlugin(
  vendor: "opencode" | "kilo",
  input: Record<string, unknown>,
): Promise<{ hooks: Hooks; spawns: SpawnCall[] }> {
  const source = renderOpencodePluginSource({ vendor, invocation: INVOCATION })
  const body = source
    .replace(/^import \{ spawn \} from "node:child_process"$/m, "")
    .replace(/^export const RoveAgentState/m, "const RoveAgentState")
  const spawns: SpawnCall[] = []
  const spawn = (command: string, args: string[]) => {
    spawns.push({ command, args })
    return { on: () => {} }
  }
  const factory = new Function("spawn", `${body}\nreturn RoveAgentState`)(spawn) as (
    i: Record<string, unknown>,
  ) => Promise<Hooks>
  return { hooks: await factory(input), spawns }
}

function payloadOf(call: SpawnCall): Record<string, unknown> {
  const flag = call.args.indexOf("--payload")
  return JSON.parse(call.args[flag + 1] as string) as Record<string, unknown>
}

function verbOf(call: SpawnCall): string {
  return call.args[call.args.indexOf("hook") + 1] as string
}

const INPUT = { directory: "/repo/worktree", worktree: "/repo" }

describe("generated opencode plugin behaviour", () => {
  it("reports a user message as a started turn, carrying cwd and session id", async () => {
    const { hooks, spawns } = await loadPlugin("opencode", INPUT)
    await hooks["chat.message"]({ sessionID: "s1" })
    expect(spawns).toHaveLength(1)
    expect(spawns[0].command).toBe("rove")
    expect(verbOf(spawns[0])).toBe("turn-start")
    expect(spawns[0].args).toContain("--engine")
    expect(spawns[0].args).toContain("opencode")
    expect(spawns[0].args[spawns[0].args.indexOf("--hook-version") + 1]).toBe(String(ROVE_HOOK_VERSION))
    expect(payloadOf(spawns[0])).toEqual({ cwd: "/repo/worktree", session_id: "s1" })
  })

  it("falls back to the worktree when no directory is supplied", async () => {
    const { hooks, spawns } = await loadPlugin("opencode", { worktree: "/repo" })
    await hooks["chat.message"]({ sessionID: "s1" })
    expect(payloadOf(spawns[0]).cwd).toBe("/repo")
  })

  it("maps each lifecycle event to its verb", async () => {
    const { hooks, spawns } = await loadPlugin("opencode", INPUT)
    const fire = (type: string, properties: Record<string, unknown> = { sessionID: "s1" }) =>
      hooks.event({ event: { type, properties } })

    await fire("session.created")
    await fire("permission.asked")
    await fire("question.asked")
    await fire("permission.replied")
    await fire("session.idle")
    await fire("session.compacted")
    await fire("session.error", { sessionID: "s1", error: "429 rate limit exceeded" })

    expect(spawns.map(verbOf)).toEqual([
      "session-start",
      "awaiting-input",
      "awaiting-input",
      "turn-start",
      "turn-complete",
      "post-compact",
      "turn-failed",
    ])
    expect(payloadOf(spawns[1]).waiting).toBe("permission")
    expect(payloadOf(spawns[2]).waiting).toBe("input")
    expect(payloadOf(spawns[6]).error_message).toBe("429 rate limit exceeded")
  })

  it("reads the session status object as well as the bare string", async () => {
    const { hooks, spawns } = await loadPlugin("opencode", INPUT)
    await hooks.event({ event: { type: "session.status", properties: { sessionID: "s1", status: "Streaming" } } })
    await hooks.event({ event: { type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } } })
    // An unrecognized status still identifies the session rather than guessing
    // at a state.
    await hooks.event({ event: { type: "session.status", properties: { sessionID: "s1", status: "who-knows" } } })
    expect(spawns.map(verbOf)).toEqual(["turn-start", "turn-complete", "session-start"])
  })

  /**
   * A sub-agent finishing must not light the "turn done" lamp while the user's
   * own turn is still running, and its id must never become the pane's session.
   * Its permission wait DOES still block the whole task, so that one reports —
   * without a session id.
   */
  it("keeps sub-agent sessions from replacing the root session or completing its turn", async () => {
    const { hooks, spawns } = await loadPlugin("opencode", INPUT)
    await hooks.event({
      event: { type: "session.created", properties: { sessionID: "child", info: { id: "child", parentID: "s1" } } },
    })
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "child" } } })
    await hooks["chat.message"]({ sessionID: "child" })
    expect(spawns).toHaveLength(0)

    await hooks.event({ event: { type: "permission.asked", properties: { sessionID: "child" } } })
    expect(spawns.map(verbOf)).toEqual(["awaiting-input"])
    expect(payloadOf(spawns[0]).session_id).toBeUndefined()
  })

  it("ignores the high-frequency and unknown events entirely", async () => {
    const { hooks, spawns } = await loadPlugin("opencode", INPUT)
    for (const type of ["tool.execute.before", "tool.execute.after", "session.deleted", "something.new"]) {
      await hooks.event({ event: { type, properties: { sessionID: "s1" } } })
    }
    expect(spawns).toHaveLength(0)
  })

  it("carries the vendor tag of whichever family member it was rendered for", async () => {
    const { hooks, spawns } = await loadPlugin("kilo", INPUT)
    await hooks["chat.message"]({ sessionID: "s1" })
    expect(spawns[0].args[spawns[0].args.indexOf("--engine") + 1]).toBe("kilo")
  })
})

describe("generated opencode plugin source", () => {
  it("exports exactly one binding", () => {
    // The loader's legacy path registers EVERY export of the module; a second
    // one either throws or doubles every report.
    const source = renderOpencodePluginSource({ vendor: "opencode", invocation: INVOCATION })
    expect(source.match(/^export /gm)).toHaveLength(1)
  })

  it("is deterministic — the same options render the same bytes", () => {
    const a = renderOpencodePluginSource({ vendor: "kilo", invocation: INVOCATION })
    const b = renderOpencodePluginSource({ vendor: "kilo", invocation: INVOCATION })
    expect(a).toBe(b)
    expect(a).not.toBe(renderOpencodePluginSource({ vendor: "opencode", invocation: INVOCATION }))
  })
})

describe("opencodeFamilyPluginPath", () => {
  // `join`, not a literal — the separator is the platform's. The subdirectory
  // spelling differs between the two CLIs; writing into the other one leaves a
  // file nothing ever loads.
  it("uses each vendor's own config dir and plugin subdirectory", () => {
    expect(opencodeFamilyConfigDir("opencode", "/home/x")).toBe(join("/home/x", ".config", "opencode"))
    expect(opencodeFamilyPluginPath("opencode", "/home/x")).toBe(
      join("/home/x", ".config", "opencode", "plugins", "rove-agent-state.js"),
    )
    expect(opencodeFamilyPluginPath("kilo", "/home/x")).toBe(
      join("/home/x", ".config", "kilo", "plugin", "rove-agent-state.js"),
    )
  })
})

describe("OpencodeFamilyHookAdapter install", () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rove-opencode-"))
    vi.stubGlobal("Bun", { which: () => "/usr/local/bin/kobe" })
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    vi.unstubAllGlobals()
  })

  it("writes nothing at all when the CLI was never installed here", async () => {
    const adapter = new OpencodeFamilyHookAdapter("opencode")
    const file = opencodeFamilyPluginPath("opencode", home)
    expect(await adapter.installActivityHooks(file)).toEqual({ ok: true })
    expect(existsSync(join(home, ".config", "opencode"))).toBe(false)
  })

  it("installs into an existing config dir, and a second run is byte-identical", async () => {
    const adapter = new OpencodeFamilyHookAdapter("kilo")
    mkdirSync(join(home, ".config", "kilo"), { recursive: true })
    const file = opencodeFamilyPluginPath("kilo", home)
    expect(await adapter.installActivityHooks(file)).toEqual({ ok: true })
    const first = readFileSync(file, "utf8")
    expect(first).toContain("--engine")
    await adapter.installActivityHooks(file)
    expect(readFileSync(file, "utf8")).toBe(first)
  })

  it("removal deletes the file Rove owns and is safe to repeat", async () => {
    const adapter = new OpencodeFamilyHookAdapter("opencode")
    mkdirSync(join(home, ".config", "opencode"), { recursive: true })
    const file = opencodeFamilyPluginPath("opencode", home)
    await adapter.installActivityHooks(file)
    await adapter.removeActivityHooks(file)
    expect(existsSync(file)).toBe(false)
    await adapter.removeActivityHooks(file)
  })
})

describe("OpencodeFamilyHookAdapter payload readers", () => {
  const adapter = new OpencodeFamilyHookAdapter("opencode")

  it("classifies a failure by what the daemon does about it", () => {
    expect(adapter.activityDetailFromPayload("turn-failed", { error_message: "429 rate limit" })).toEqual({
      failure: "rate_limit",
      note: "429 rate limit",
    })
    // A 402 arrives as a four-hundred like a 429 does, but an exhausted
    // balance needs a human — it must not arm the auto-resume timer.
    expect(adapter.activityDetailFromPayload("turn-failed", { error_message: "insufficient credits" })).toMatchObject({
      failure: "billing",
    })
    expect(adapter.activityDetailFromPayload("turn-failed", {})).toEqual({ failure: "other" })
  })

  it("names which wait it is", () => {
    expect(adapter.activityDetailFromPayload("awaiting-input", { waiting: "input" })).toEqual({ waiting: "input" })
    expect(adapter.activityDetailFromPayload("awaiting-input", {})).toEqual({ waiting: "permission" })
    expect(adapter.activityDetailFromPayload("turn-start", {})).toBeUndefined()
  })

  it("takes the session id and answers nothing without one", () => {
    expect(adapter.sessionFromPayload({ session_id: "s1" })).toEqual({ sessionId: "s1" })
    expect(adapter.sessionFromPayload({})).toBeUndefined()
  })
})
