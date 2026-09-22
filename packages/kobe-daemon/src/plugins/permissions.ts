/**
 * Owner-only repair for the installed-plugin tree. `docs/PLUGIN-AUTHORING.md`
 * promises the config `.env`, state dir and `log.jsonl` are 0600/0700, but
 * `mode` binds only at creation and `writePluginSettings` rewrites `.env` in
 * place, so an install created without the mode keeps 0755/0644. Repair on the
 * way past, like `web-token.ts` and `pty-freeze-store.ts`.
 *
 * Sync because every caller is (daemon boot, `writePluginSettings`).
 * Best-effort: a failing chmod must not block boot or a settings save.
 */

import { chmodSync } from "node:fs"
import { OWNER_ONLY_DIR_MODE, OWNER_ONLY_FILE_MODE } from "../daemon/owner-only.ts"
import {
  pluginConfigDir,
  pluginDataDir,
  pluginLogPath,
  pluginRegistryPath,
  pluginStateDir,
  pluginsRootDir,
} from "./plugin-paths.ts"
import { loadPluginRegistry } from "./registry.ts"

function tighten(path: string, mode: number): void {
  try {
    chmodSync(path, mode)
  } catch {
    /* absent, not ours, or a filesystem without modes */
  }
}

/** Repair one plugin's modes, directories included: a 0600 file in a 0755
 *  directory still leaks its name and mtime. */
export function tightenPluginPermissions(id: string, homeDir?: string): void {
  tighten(pluginDataDir(id, homeDir), OWNER_ONLY_DIR_MODE)
  tighten(pluginConfigDir(id, homeDir), OWNER_ONLY_DIR_MODE)
  tighten(pluginStateDir(id, homeDir), OWNER_ONLY_DIR_MODE)
  tighten(`${pluginConfigDir(id, homeDir)}/.env`, OWNER_ONLY_FILE_MODE)
  tighten(pluginLogPath(id, homeDir), OWNER_ONLY_FILE_MODE)
}

/** Repair every registered plugin, once per daemon boot — the only point that
 *  reaches installs a creation-time mode missed. */
export function tightenInstalledPluginPermissions(homeDir?: string): void {
  tighten(pluginsRootDir(homeDir), OWNER_ONLY_DIR_MODE)
  // Names every plugin and its checkout path; an in-place rewrite never fixes
  // an old 0644.
  tighten(pluginRegistryPath(homeDir), OWNER_ONLY_FILE_MODE)
  for (const entry of loadPluginRegistry(homeDir).plugins) tightenPluginPermissions(entry.id, homeDir)
}
