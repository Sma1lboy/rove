/**
 * Hermes: the `config.yaml` edit, the generated plugin package, and the
 * install that needs BOTH to land before a single report arrives.
 *
 * The config edit carries the weight. It is line-based because Rove has no
 * YAML library and a round-trip through one would reformat a config the user
 * hand-wrote, so these pin the two things that makes necessary: the shapes it
 * edits leave every other line — comments included — untouched, and the shapes
 * it does not understand are REFUSED rather than guessed at.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HERMES_PLUGIN_NAME, setHermesPluginEnabled } from "@/engine/hermes-local/config-yaml"
import { HermesHookAdapter, hermesConfigPath, hermesPluginDir } from "@/engine/hermes-local/hook-adapter"
import { renderHermesPluginSource } from "@/engine/hermes-local/plugin-source"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

function enable(content: string): string {
  const edit = setHermesPluginEnabled(content, true)
  if (!edit.ok) throw new Error(`refused: ${edit.reason}`)
  return edit.content
}

describe("setHermesPluginEnabled — shapes it edits", () => {
  it("writes the whole block into an empty or plugin-less config", () => {
    expect(enable("")).toBe(`plugins:\n  enabled:\n    - ${HERMES_PLUGIN_NAME}\n`)
    expect(enable("model: sonnet\n")).toBe(`model: sonnet\nplugins:\n  enabled:\n    - ${HERMES_PLUGIN_NAME}\n`)
  })

  it("inserts into an existing enabled list and leaves comments and siblings alone", () => {
    const before = [
      "# my hermes config",
      "model: sonnet",
      "plugins:",
      "  enabled:",
      "    - other-plugin",
      "theme: dark",
      "",
    ].join("\n")
    expect(enable(before)).toBe(
      [
        "# my hermes config",
        "model: sonnet",
        "plugins:",
        "  enabled:",
        `    - ${HERMES_PLUGIN_NAME}`,
        "    - other-plugin",
        "theme: dark",
        "",
      ].join("\n"),
    )
  })

  it("expands an empty inline list to a block list", () => {
    expect(enable("plugins:\n  enabled: []\n")).toBe(`plugins:\n  enabled:\n    - ${HERMES_PLUGIN_NAME}\n`)
  })

  it("matches the list's own indentation rather than imposing four spaces", () => {
    const before = "plugins:\n  enabled:\n  - other-plugin\n"
    expect(enable(before)).toBe(`plugins:\n  enabled:\n  - ${HERMES_PLUGIN_NAME}\n  - other-plugin\n`)
  })

  it("is idempotent — a second enable returns the content untouched", () => {
    const once = enable("plugins:\n  enabled:\n    - other-plugin\n")
    expect(enable(once)).toBe(once)
  })

  it("recognizes a quoted entry as already present", () => {
    const quoted = `plugins:\n  enabled:\n    - "${HERMES_PLUGIN_NAME}"\n`
    expect(enable(quoted)).toBe(quoted)
  })

  it("removes only Rove's entry, and removing twice is a no-op", () => {
    const withOurs = enable("plugins:\n  enabled:\n    - other-plugin\n")
    const off = setHermesPluginEnabled(withOurs, false)
    expect(off).toEqual({ ok: true, content: "plugins:\n  enabled:\n    - other-plugin\n" })
    expect(setHermesPluginEnabled(off.ok ? off.content : "", false)).toEqual({
      ok: true,
      content: "plugins:\n  enabled:\n    - other-plugin\n",
    })
  })

  it("does not invent a plugins block when asked to disable", () => {
    expect(setHermesPluginEnabled("model: sonnet\n", false)).toEqual({ ok: true, content: "model: sonnet\n" })
  })
})

describe("setHermesPluginEnabled — shapes it refuses", () => {
  // Every one of these is editable in principle; none is editable without
  // rewriting lines the user wrote. Naming the shape beats reformatting it.
  it("refuses a flow sequence on plugins", () => {
    expect(setHermesPluginEnabled("plugins: [a, b]\n", true)).toEqual({
      ok: false,
      reason: '"plugins" is written inline; Rove only edits a block mapping',
    })
  })

  it("refuses a non-empty flow sequence on enabled", () => {
    expect(setHermesPluginEnabled("plugins:\n  enabled: [a]\n", true)).toEqual({
      ok: false,
      reason: '"plugins.enabled" is written inline; Rove only edits a block list',
    })
  })

  it("refuses a plugins block with no enabled key", () => {
    expect(setHermesPluginEnabled("plugins:\n  disabled:\n    - x\n", true)).toEqual({
      ok: false,
      reason: '"plugins" has no "enabled" key that Rove can add to',
    })
  })
})

describe("generated hermes plugin", () => {
  it("is deterministic and gated to interactive platforms", () => {
    const opts = { vendor: "hermes", invocation: ["rove"] } as const
    const source = renderHermesPluginSource(opts)
    expect(renderHermesPluginSource(opts)).toBe(source)
    expect(source).toContain('_INTERACTIVE_PLATFORMS = {"cli", "tui", "desktop", "acp"}')
    expect(source).toContain('"hook",\n        "session-start",')
    // The per-model-request hook would re-report the same identity on every
    // call; only the two session edges are registered.
    expect(source).toContain('ctx.register_hook("on_session_start", _report)')
    expect(source).not.toContain('pre_llm_call", _report')
  })
})

describe("hermes paths", () => {
  // `join`, not a literal — the separator is the platform's.
  it("names config.yaml and the plugin package under ~/.hermes", () => {
    expect(hermesConfigPath("/home/x")).toBe(join("/home/x", ".hermes", "config.yaml"))
    expect(hermesPluginDir("/home/x")).toBe(join("/home/x", ".hermes", "plugins", HERMES_PLUGIN_NAME))
  })
})

describe("HermesHookAdapter install", () => {
  let home: string
  const adapter = new HermesHookAdapter()

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rove-hermes-"))
    vi.stubEnv("ROVE_HOME_DIR", join(home, "rove"))
    vi.stubGlobal("Bun", { which: () => "/usr/local/bin/kobe" })
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("writes nothing at all when hermes was never installed here", async () => {
    const file = hermesConfigPath(home)
    expect(await adapter.installActivityHooks(file, { quiet: true })).toEqual({ ok: true })
    expect(existsSync(join(home, ".hermes"))).toBe(false)
  })

  it("writes both plugin files AND the enable line, and a second run is byte-identical", async () => {
    mkdirSync(join(home, ".hermes"))
    const file = hermesConfigPath(home)
    expect(await adapter.installActivityHooks(file, { quiet: true })).toEqual({ ok: true })

    const dir = hermesPluginDir(home)
    const manifest = readFileSync(join(dir, "plugin.yaml"), "utf8")
    const init = readFileSync(join(dir, "__init__.py"), "utf8")
    const config = readFileSync(file, "utf8")
    expect(manifest).toContain(`name: ${HERMES_PLUGIN_NAME}`)
    expect(init).toContain("--engine")
    expect(config).toBe(`plugins:\n  enabled:\n    - ${HERMES_PLUGIN_NAME}\n`)

    await adapter.installActivityHooks(file, { quiet: true })
    expect(readFileSync(join(dir, "__init__.py"), "utf8")).toBe(init)
    expect(readFileSync(file, "utf8")).toBe(config)
  })

  it("keeps the user's own config around the enable line and restores it on removal", async () => {
    mkdirSync(join(home, ".hermes"))
    const file = hermesConfigPath(home)
    const before = "# mine\nmodel: sonnet\nplugins:\n  enabled:\n    - other-plugin\n"
    writeFileSync(file, before)
    await adapter.installActivityHooks(file, { quiet: true })
    expect(readFileSync(file, "utf8")).toBe(
      `# mine\nmodel: sonnet\nplugins:\n  enabled:\n    - ${HERMES_PLUGIN_NAME}\n    - other-plugin\n`,
    )
    await adapter.removeActivityHooks(file)
    expect(readFileSync(file, "utf8")).toBe(before)
    expect(existsSync(hermesPluginDir(home))).toBe(false)
  })

  // The plugin files are Rove's own directory and cost nothing while dormant,
  // so they are still written; only the enable line is refused, and the user's
  // config is returned byte-for-byte.
  it("refuses a config shape it cannot edit without rewriting the user's lines", async () => {
    mkdirSync(join(home, ".hermes"))
    const file = hermesConfigPath(home)
    writeFileSync(file, "plugins: [a, b]\n")
    const outcome = await adapter.installActivityHooks(file, { quiet: true })
    expect(outcome).toEqual({
      ok: false,
      file,
      reason: '"plugins" is written inline; Rove only edits a block mapping',
    })
    expect(readFileSync(file, "utf8")).toBe("plugins: [a, b]\n")
    expect(adapter.hookConfigRefusal("plugins: [a, b]\n")).toBe(
      '"plugins" is written inline; Rove only edits a block mapping',
    )
    expect(adapter.hookConfigRefusal("plugins:\n  enabled:\n    - x\n")).toBeUndefined()
  })
})

describe("HermesHookAdapter payload readers", () => {
  const adapter = new HermesHookAdapter()

  it("takes the session id and answers nothing without one", () => {
    expect(adapter.sessionFromPayload({ session_id: "s1" })).toEqual({ sessionId: "s1" })
    expect(adapter.sessionFromPayload({})).toBeUndefined()
  })

  // The session hooks say nothing about state; the screen manifest owns that.
  it("attaches no activity detail", () => {
    expect(adapter.activityDetailFromPayload()).toBeUndefined()
  })
})
