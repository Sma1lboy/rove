/**
 * `bun e2e/hero-plugins.ts` — link every SDK example plugin into the hero
 * fixture, so the plugin captures film the real host surfaces (`ctrl+e`
 * picker, Settings → Plugins, the engine selector) rather than a shell
 * tailing a log file.
 *
 * Split from `hero-fixture.ts` for the same reason `hero-issues.ts` is: the
 * examples change on their own cadence and want to be re-linkable without
 * paying for a fixture rebuild.
 *
 * Costs no engine quota and is idempotent — `plugin link` re-registers an
 * already-linked directory in place.
 *
 * ORDERING MATTERS: the TUI reads the plugin registry ONCE at boot
 * (`loadPluginEngines()` in `tui/index.tsx`, and the pane/settings sections
 * alongside it). Linking mid-recording registers nothing the running TUI can
 * see, so every example is linked here — before `hero-serve.ts` starts the
 * harness — and the storyboards only ever USE what is already installed.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { HERO_CLI, HERO_HOME, KOBE_DIR, assertHeroIsolation, heroEnv } from "./hero-env.ts"

const REPO_ROOT = resolve(import.meta.dirname, "../../..")
const EXAMPLES = join(REPO_ROOT, "packages", "kobe-plugin-sdk", "examples")

/** Every example under `packages/kobe-plugin-sdk/examples/`, in doc order. */
export const EXAMPLE_PLUGINS: readonly { readonly dir: string; readonly id: string }[] = [
  { dir: "hello-events", id: "examples.hello-events" },
  { dir: "turn-notify", id: "examples.turn-notify" },
  { dir: "settings-demo", id: "examples.settings-demo" },
  { dir: "task-board", id: "examples.task-board" },
  { dir: "contrib-engine", id: "examples.contrib-engine" },
]

function run(args: readonly string[]): string {
  const proc = Bun.spawnSync(["bun", HERO_CLI, ...args], { cwd: KOBE_DIR, env: heroEnv(), stdio: ["ignore", "pipe", "pipe"] })
  const out = new TextDecoder().decode(proc.stdout).trim()
  if (proc.exitCode !== 0) {
    throw new Error(`rove ${args.join(" ")} failed: ${new TextDecoder().decode(proc.stderr).trim() || out}`)
  }
  return out
}

/**
 * Non-default values for `settings-demo`, written where the plugin reads them
 * (`$ROVE_PLUGIN_CONFIG_DIR/.env`). Settings → Plugins renders declared
 * settings whatever their value, but a section showing only the manifest
 * defaults photographs as inert — these prove the editor round-trips.
 */
function seedSettingsDemoConfig(): void {
  const dir = join(HERO_HOME, ".rove", "plugins", "examples.settings-demo", "config")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, ".env"), "EX_DEMO_NAME=Orbit\nEX_DEMO_THEME=dark\nEX_DEMO_NOTIFY=1\n")
}

if (!existsSync(HERO_HOME)) throw new Error(`no hero fixture at ${HERO_HOME} — run \`bun e2e/hero-fixture.ts --fresh\``)
assertHeroIsolation()

for (const plugin of EXAMPLE_PLUGINS) {
  const root = join(EXAMPLES, plugin.dir)
  if (!existsSync(root)) throw new Error(`missing example: ${root}`)
  run(["plugin", "link", root])
  console.log(`[hero:plugins] linked ${plugin.id}`)
}

seedSettingsDemoConfig()
console.log("[hero:plugins] seeded settings-demo config")

console.log(run(["plugin", "list"]))
