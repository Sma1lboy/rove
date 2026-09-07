/**
 * Owner-only repair for the installed-plugin tree.
 *
 * `docs/PLUGIN-AUTHORING.md` invites authors to keep API keys in the config
 * `.env` and states flatly that the `.env`, the state directory and
 * `log.jsonl` "are all owner-only (0600/0700)". The install path does create
 * them that way — but `mkdirSync`/`writeFileSync`'s `mode` binds only at
 * creation, and `writePluginSettings` rewrites an existing `.env` in place. So
 * a plugin installed before those mode arguments landed keeps 0755/0644 for
 * the life of the install, and rewriting its settings never corrects it. The
 * documented sentence was true for new installs and false for every old one.
 *
 * The remedy is the same shape the two sibling credential stores already use
 * (`web-token.ts`'s `tightenTokenPermissions`, and `pty-freeze-store.ts`'s
 * chmod-every-record loop): repair on the way past, not only on creation.
 *
 * Sync because every caller is — the daemon's boot sequence runs this once,
 * and `writePluginSettings` is a synchronous store. Best-effort throughout: a
 * plugin whose tree cannot be chmod'd must not keep the daemon from booting or
 * a settings edit from saving.
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

/**
 * Repair one plugin's config/state/log modes.
 *
 * The parent directories are included, not just the `.env`: a 0600 file inside
 * a 0755 directory still leaks its name and mtime, and the state directory the
 * docs name is a directory, so the promise is only kept if both halves are.
 */
export function tightenPluginPermissions(id: string, homeDir?: string): void {
  tighten(pluginDataDir(id, homeDir), OWNER_ONLY_DIR_MODE)
  tighten(pluginConfigDir(id, homeDir), OWNER_ONLY_DIR_MODE)
  tighten(pluginStateDir(id, homeDir), OWNER_ONLY_DIR_MODE)
  tighten(`${pluginConfigDir(id, homeDir)}/.env`, OWNER_ONLY_FILE_MODE)
  tighten(pluginLogPath(id, homeDir), OWNER_ONLY_FILE_MODE)
}

/**
 * Repair every registered plugin. Called once per daemon boot, which is the
 * moment that covers an install predating the mode arguments — the population
 * a creation-time fix cannot reach.
 */
export function tightenInstalledPluginPermissions(homeDir?: string): void {
  tighten(pluginsRootDir(homeDir), OWNER_ONLY_DIR_MODE)
  // `savePluginRegistry` already writes this 0600, and for the same reason it
  // names every installed plugin and its checkout path. A registry that
  // predates that mode argument is still 0644, and rewriting it in place never
  // corrects it.
  tighten(pluginRegistryPath(homeDir), OWNER_ONLY_FILE_MODE)
  for (const entry of loadPluginRegistry(homeDir).plugins) tightenPluginPermissions(entry.id, homeDir)
}
