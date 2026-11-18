/**
 * Drift guard for the Claude Code plugin (`claude-plugin/` at the repo root).
 *
 * The plugin's `hooks/hooks.json` is a static copy of what the Claude hook
 * adapter would write into `~/.claude/settings.json` — same events, same
 * matchers, same `hook <verb> --engine claude` commands, just invoked through
 * the bundled `bin/rove` wrapper by absolute `${CLAUDE_PLUGIN_ROOT}` path.
 * Static copies drift, so this test derives the expected set from the SAME
 * source of truth the adapter uses ({@link CLAUDE_HOOK_EVENT_MAP}) and fails
 * the moment either side moves without the other.
 *
 * The bundled skill is likewise a copy of `.agents/skills/rove/SKILL.md`
 * (the canonical skill the npx installer ships); byte-identity keeps the two
 * install paths teaching the same thing.
 */

import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { CLAUDE_HOOK_EVENT_MAP } from "../../src/engine/claude-code-local/hook-adapter.ts"

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const PLUGIN = join(ROOT, "claude-plugin")

/** Tool-family verbs are volume-gated in the settings-managed install
 *  (JsonHookAdapter.gatedVerbs) and a static hooks.json cannot gate, so the
 *  plugin ships without them — the daemon-side plugin system keeps managing
 *  those through settings.json when a Rove plugin subscribes. */
const GATED_VERBS = new Set(["tool-pre", "tool-post", "tool-failed"])

interface HookGroup {
  matcher?: string
  hooks: Array<{ type: string; command: string }>
}

function pluginHooks(): Record<string, HookGroup[]> {
  const parsed = JSON.parse(readFileSync(join(PLUGIN, "hooks", "hooks.json"), "utf8")) as {
    hooks: Record<string, HookGroup[]>
  }
  return parsed.hooks
}

describe("claude-plugin hooks.json mirrors the Claude hook adapter", () => {
  test.each(CLAUDE_HOOK_EVENT_MAP.filter((spec) => !GATED_VERBS.has(spec.verb)))(
    "$event $matcher has exactly one matching plugin hook group",
    (spec) => {
      const groups = (pluginHooks()[spec.event] ?? []).filter((g) => (g.matcher ?? undefined) === spec.matcher)
      expect(groups.map((g) => g.hooks.map((h) => h.command))).toEqual([
        [`"\${CLAUDE_PLUGIN_ROOT}/bin/rove" hook ${spec.verb} --engine claude`],
      ])
    },
  )

  // A PostToolUse(Bash) observer firing `hook worktree-created` after EVERY
  // Bash call costs a ~170ms process spawn per Bash call, and there is no
  // archive step left for it to drive. A plugin install pays that cost too,
  // so the plugin must not ship it.
  test("the retired worktree-watch observer is NOT shipped", () => {
    expect(JSON.stringify(pluginHooks())).not.toContain("worktree-created")
  })

  test("no extra events beyond the adapter's map", () => {
    const known = new Set(CLAUDE_HOOK_EVENT_MAP.map((s) => s.event))
    expect(Object.keys(pluginHooks()).filter((event) => !known.has(event))).toEqual([])
  })

  test.each([...GATED_VERBS])("gated verb %s stays OUT of the static hooks.json", (verb) => {
    expect(JSON.stringify(pluginHooks())).not.toContain(`hook ${verb}`)
  })
})

describe("claude-plugin bundle integrity", () => {
  // Every file of the skill, not just SKILL.md: the reference under
  // `references/` had already drifted between the two copies (a `tab-close`
  // row and its prose existed canonically and not in the bundle) while this
  // test watched SKILL.md alone and stayed green.
  test.each(["SKILL.md", join("references", "api-flags.md")])(
    "bundled %s is byte-identical to the canonical skill",
    (file) => {
      const canonical = readFileSync(join(ROOT, ".agents", "skills", "rove", file), "utf8")
      const bundled = readFileSync(join(PLUGIN, "skills", "rove", file), "utf8")
      expect(bundled).toBe(canonical)
    },
  )

  test("plugin.json points at hooks.json and names the plugin rove", () => {
    const manifest = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")) as {
      name: string
      hooks: string
    }
    expect(manifest.name).toBe("rove")
    expect(manifest.hooks).toBe("./hooks/hooks.json")
  })

  test("marketplace.json exposes the plugin from ./claude-plugin", () => {
    const market = JSON.parse(readFileSync(join(ROOT, ".claude-plugin", "marketplace.json"), "utf8")) as {
      name: string
      plugins: Array<{ name: string; source: string }>
    }
    expect(market.plugins.some((p) => p.name === "rove" && p.source === "./claude-plugin")).toBe(true)
  })

  test("bin/rove wrapper is executable", () => {
    const mode = statSync(join(PLUGIN, "bin", "rove")).mode
    expect(mode & 0o111, "bin/rove must keep its executable bit").not.toBe(0)
  })
})
