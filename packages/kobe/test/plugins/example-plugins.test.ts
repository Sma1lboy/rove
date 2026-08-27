/**
 * The SDK examples are the first thing a plugin author copies, so a drifted
 * manifest field or a renamed hook costs them their afternoon. Nothing else
 * loads them: they are outside every runtime path and every other test.
 *
 * Discovery is by directory listing — a sixth example is covered the moment
 * it lands, without editing this file.
 */
import { existsSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { readPluginManifest } from "@sma1lboy/kobe-daemon/plugins/manifest"
import { describe, expect, it } from "vitest"

const EXAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../kobe-plugin-sdk/examples")

const EXAMPLES = readdirSync(EXAMPLES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

/** Every declared command is argv, and every example launches its entrypoint
 *  by relative path (`$ROVE_PLUGIN_ROOT/` prefixed or bare). */
const SCRIPT_ARG_RE = /\.(ts|js|mjs|cjs|sh)$/

function declaredScripts(command: readonly string[]): string[] {
  return command
    .slice(1)
    .map((arg) => arg.replace(/^\$ROVE_PLUGIN_ROOT\//, ""))
    .filter((arg) => SCRIPT_ARG_RE.test(arg))
}

describe("plugin SDK examples", () => {
  it("finds the example directories", () => {
    expect(EXAMPLES.length).toBeGreaterThan(0)
  })

  it.each(EXAMPLES)("%s parses through the real manifest parser", (name) => {
    const { manifest, warnings } = readPluginManifest(join(EXAMPLES_DIR, name))

    expect(manifest.id).toBe(`examples.${name}`)
    // A misspelled event name, an unsupported pane placement and a stale
    // version key are all warnings, not throws — an example that earns one
    // still installs and then silently does nothing. The missing `platforms`
    // note is deliberate: the examples run everywhere.
    expect(warnings.filter((w) => !w.includes("`platforms`"))).toEqual([])
  })

  it.each(EXAMPLES)("%s ships every entrypoint it declares", (name) => {
    const root = join(EXAMPLES_DIR, name)
    const { manifest } = readPluginManifest(root)
    const commands = [
      ...manifest.build,
      ...manifest.startup,
      ...manifest.shutdown,
      ...manifest.actions,
      ...manifest.events,
      ...manifest.panes,
      ...manifest.engines,
    ]

    const missing = commands
      .flatMap((spec) => declaredScripts(spec.command))
      .filter((rel) => !existsSync(join(root, rel)))
    expect(missing).toEqual([])
  })
})
