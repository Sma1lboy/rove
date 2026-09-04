/**
 * Plugin settings storage — plain `KEY=value` lines in the plugin's config
 * `.env` (the file plugin commands already source). The `[[settings]]`
 * manifest section is the SCHEMA; this module is the store: read current
 * values, merge edits in place, and resolve the Files-pane file handlers.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { type PluginManifest, qualifiedActionId, readPluginManifest } from "./manifest.ts"
import { tightenPluginPermissions } from "./permissions.ts"
import { pluginConfigDir } from "./plugin-paths.ts"
import { loadPluginRegistry } from "./registry.ts"

function envPath(pluginId: string, homeDir?: string): string {
  return join(pluginConfigDir(pluginId, homeDir), ".env")
}

/** Current `KEY=value` pairs from the plugin's config .env (missing → {}). */
export function readPluginSettings(pluginId: string, homeDir?: string): Record<string, string> {
  let text: string
  try {
    text = readFileSync(envPath(pluginId, homeDir), "utf8")
  } catch {
    return {}
  }
  const out: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (m) out[m[1] as string] = m[2] as string
  }
  return out
}

/**
 * A value is one `KEY=value` line, so it may not contain a line break. A
 * newline in the middle of a value would end the assignment early and let
 * everything after it parse as its own `KEY=` line — the user edits one
 * innocuous-looking setting and silently defines a second variable in a file
 * plugin commands source. Strip rather than reject: the store is called from
 * a dialog with no error channel, and no legitimate value wants a newline.
 */
function oneLine(value: string): string {
  return value.replace(/[\r\n]/g, "")
}

/**
 * Merge `values` into the .env, preserving unrelated lines/comments. An
 * empty-string value REMOVES the key (booleans store "1" or absent).
 */
export function writePluginSettings(pluginId: string, values: Record<string, string>, homeDir?: string): void {
  const path = envPath(pluginId, homeDir)
  let lines: string[] = []
  try {
    lines = readFileSync(path, "utf8").split("\n")
  } catch {
    /* fresh file */
  }
  const remaining = { ...values }
  const next: string[] = []
  for (const line of lines) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)
    const key = m?.[1]
    if (key && key in remaining) {
      const value = oneLine(remaining[key] as string)
      delete remaining[key]
      if (value !== "") next.push(`${key}=${value}`)
      continue // empty → drop the line
    }
    next.push(line)
  }
  for (const [key, raw] of Object.entries(remaining)) {
    const value = oneLine(raw)
    if (value !== "") next.push(`${key}=${value}`)
  }
  while (next.length > 0 && next[next.length - 1] === "") next.pop()
  // 0700/0600: this .env is where PLUGIN-AUTHORING tells authors to keep API
  // keys, so it must not be world-readable like the manifest beside it. The
  // `mode` arguments only cover a FRESH path — this is a rewrite-in-place, so
  // an existing 0644 .env keeps 0644 through every save. Hence the repair
  // afterwards, which is what actually closes an old install.
  mkdirSync(pluginConfigDir(pluginId, homeDir), { recursive: true, mode: 0o700 })
  writeFileSync(path, next.length > 0 ? `${next.join("\n")}\n` : "", { mode: 0o600 })
  tightenPluginPermissions(pluginId, homeDir)
}

/**
 * The Files-pane routing question: does an enabled plugin claim this file?
 * First enabled plugin (registry order) with a matching `[[file_handlers]]`
 * pattern wins; returns the qualified action to invoke with the file path.
 */
export function findFileHandler(fileName: string, homeDir?: string): { qualifiedAction: string } | null {
  for (const entry of loadPluginRegistry(homeDir).plugins) {
    if (!entry.enabled) continue
    let manifest: PluginManifest
    try {
      manifest = readPluginManifest(entry.root).manifest
    } catch {
      continue
    }
    for (const handler of manifest.fileHandlers) {
      try {
        if (new RegExp(handler.pattern, "i").test(fileName)) {
          return { qualifiedAction: qualifiedActionId(entry.id, handler.action) }
        }
      } catch {
        /* bad pattern → skip */
      }
    }
  }
  return null
}
