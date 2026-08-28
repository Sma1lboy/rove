/**
 * Filesystem layout for installed plugins, all under `<home>/.rove/`:
 *
 *   plugins.json                  — the registry (see plugins/registry.ts)
 *   plugins/<id>/checkout/        — managed source checkout (GitHub installs only)
 *   plugins/<id>/config/          — user-editable config (.env etc.); plugin-owned format
 *   plugins/<id>/state/           — plugin-owned runtime state
 *   plugins/<id>/log.jsonl        — command-run log (appended by the runtime)
 *
 * Linked (local-dev) plugins keep their root wherever the author works;
 * config/state still live here so uninstall/relink never loses user data.
 */

import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { COMPAT_STATE_DIR_BASENAME, ROVE_STATE_DIR_BASENAME, readRoveEnv } from "../compat-env.ts"

/**
 * Plugins live under the canonical state dir. An install predating the rename
 * is still under `.kobe`, and its registry is the only thing that says which
 * plugins exist — so a home whose canonical registry is absent keeps reading
 * the legacy tree until the daemon's startup migration moves it across
 * (`state/layout-migration.ts`). Never a copy at read time: the registry has
 * exactly one writer.
 */
function stateRoot(homeDir?: string): string {
  const home = homeDir ?? readRoveEnv("HOME_DIR") ?? homedir()
  const canonical = join(home, ROVE_STATE_DIR_BASENAME)
  if (existsSync(join(canonical, "plugins.json"))) return canonical
  const legacy = join(home, COMPAT_STATE_DIR_BASENAME)
  return existsSync(join(legacy, "plugins.json")) ? legacy : canonical
}

export function pluginRegistryPath(homeDir?: string): string {
  return join(stateRoot(homeDir), "plugins.json")
}

/** Parent of every per-plugin directory — also where installs stage their clone. */
export function pluginsRootDir(homeDir?: string): string {
  return join(stateRoot(homeDir), "plugins")
}

export function pluginDataDir(id: string, homeDir?: string): string {
  return join(pluginsRootDir(homeDir), id)
}

export function pluginCheckoutDir(id: string, homeDir?: string): string {
  return join(pluginDataDir(id, homeDir), "checkout")
}

export function pluginConfigDir(id: string, homeDir?: string): string {
  return join(pluginDataDir(id, homeDir), "config")
}

export function pluginStateDir(id: string, homeDir?: string): string {
  return join(pluginDataDir(id, homeDir), "state")
}

export function pluginLogPath(id: string, homeDir?: string): string {
  return join(pluginDataDir(id, homeDir), "log.jsonl")
}

/** CLI-written `plugin outdated` cache the Settings pane reads (advisory). */
export function pluginsOutdatedCachePath(homeDir?: string): string {
  return join(stateRoot(homeDir), "plugins-outdated.json")
}
