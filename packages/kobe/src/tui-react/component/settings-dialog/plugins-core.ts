/**
 * Framework-free view model for the Settings → Plugins section: turns a
 * `~/.rove/plugins.json` entry plus its `rove-plugin.toml` and the tail of
 * its `log.jsonl` into one row. Accepts canonical and legacy manifest
 * spellings. Pure except the disk wrappers; the daemon
 * (`@sma1lboy/kobe-daemon/plugins/*`) owns the layout.
 */

import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs"
import {
  currentPluginPlatform,
  parsePluginManifest,
  pluginManifestPath,
  supportsPlatform,
} from "@sma1lboy/kobe-daemon/plugins/manifest"
import { readOutdatedCache } from "@sma1lboy/kobe-daemon/plugins/outdated-cache"
import { pluginLogPath } from "@sma1lboy/kobe-daemon/plugins/plugin-paths"
import {
  type PluginRegistryEntry,
  loadPluginRegistry,
  savePluginRegistry,
} from "@sma1lboy/kobe-daemon/plugins/registry"
import { readPluginSettings, writePluginSettings } from "@sma1lboy/kobe-daemon/plugins/settings-env"
import { reloadPluginEngines } from "../../../engine/plugin-engines.ts"
import { type PluginSettingRowView, pluginSettingRows } from "./plugin-settings-core"

/** Last appended `log.jsonl` record, normalized for display. */
export interface PluginLastRun {
  readonly at: number
  /** Event name / `startup` / action id — whatever the runtime logged. */
  readonly label: string
  readonly exitCode: number | null
  readonly ok: boolean
  /** Hook not exited: logged once it outlives its slow threshold, so a hang is visible. */
  readonly running: boolean
  readonly spawnError?: string
}

interface PluginDeclares {
  readonly actions: number
  readonly events: number
  readonly panes: number
  readonly engines: number
}

export interface PluginRowView {
  readonly id: string
  readonly version: string
  readonly enabled: boolean
  /** `rove plugin link` install — `source` is then the author's directory. */
  readonly linked: boolean
  /** Linked path, or the `owner/repo` install spec. */
  readonly source: string
  /** null when no supported plugin manifest is present or parsable. */
  readonly declares: PluginDeclares | null
  /** False when the manifest excludes this platform (the daemon skips it). */
  readonly platformOk: boolean
  /** Declares a runnable command (actions/events/startup); "never run" means nothing otherwise. */
  readonly hooksDeclared: boolean
  readonly lastRun: PluginLastRun | null
  /** Declared `[[settings]]` joined with their stored values; [] when none. */
  readonly settings: readonly PluginSettingRowView[]
  /** From the CLI-written outdated cache (`rove plugin outdated`); advisory. */
  readonly updateAvailable: boolean
}

/**
 * Newest parsable record: a half-written trailing line (appended while we
 * read) must not blank the row.
 */
export function parseLastRun(logText: string | null): PluginLastRun | null {
  if (!logText) return null
  const lines = logText.trimEnd().split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim()
    if (!line) continue
    let record: Record<string, unknown>
    try {
      record = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (typeof record.at !== "number") continue
    const exitCode = typeof record.exitCode === "number" ? record.exitCode : null
    const spawnError = typeof record.spawnError === "string" ? record.spawnError : undefined
    const running = record.phase === "running"
    return {
      at: record.at,
      label: typeof record.label === "string" ? record.label : typeof record.kind === "string" ? record.kind : "run",
      exitCode,
      // In-flight is neither ok nor failed; `running` carries that state.
      ok: !running && spawnError === undefined && exitCode === 0,
      running,
      ...(spawnError ? { spawnError } : {}),
    }
  }
  return null
}

/** One row from a registry entry + the raw text of its manifest and log. */
export function pluginRowView(
  outdated: ReadonlySet<string>,
  entry: PluginRegistryEntry,
  manifestText: string | null,
  logText: string | null,
  settingValues: Record<string, string> = {},
): PluginRowView {
  let declares: PluginDeclares | null = null
  let settings: readonly PluginSettingRowView[] = []
  // Unknown (unparsable manifest) must not pile a platform warning on top of
  // "manifest unreadable" — true means "no evidence it is unsupported".
  let platformOk = true
  let hooksDeclared = false
  if (manifestText !== null) {
    try {
      const { manifest } = parsePluginManifest(manifestText)
      declares = {
        actions: manifest.actions.length,
        events: manifest.events.length,
        panes: manifest.panes.length,
        engines: manifest.engines.length,
      }
      hooksDeclared = manifest.actions.length + manifest.events.length + manifest.startup.length > 0
      platformOk = supportsPlatform({}, manifest, currentPluginPlatform())
      settings = pluginSettingRows(manifest.settings, settingValues)
    } catch {
      declares = null
    }
  }
  return {
    id: entry.id,
    version: entry.version,
    enabled: entry.enabled,
    linked: entry.source.kind === "link",
    source: entry.source.kind === "link" ? entry.root : entry.source.spec,
    declares,
    platformOk,
    hooksDeclared,
    lastRun: parseLastRun(logText),
    settings,
    updateAvailable: outdated.has(entry.id),
  }
}

/** ponytail: only the last record is shown, so read the log's tail, not all of it. */
const LOG_TAIL_BYTES = 64 * 1024

function readTail(path: string): string | null {
  let fd: number | undefined
  try {
    const size = statSync(path).size
    const length = Math.min(size, LOG_TAIL_BYTES)
    const buf = Buffer.alloc(length)
    fd = openSync(path, "r")
    readSync(fd, buf, 0, length, size - length)
    return buf.toString("utf8")
  } catch {
    return null
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function readTextOrNull(path: string | null): string | null {
  if (!path) return null
  try {
    return readFileSync(path, "utf8")
  } catch {
    return null
  }
}

/** Every registered plugin, in registry order, ready to render. */
export function readPluginRows(homeDir?: string): PluginRowView[] {
  const outdated = new Set(readOutdatedCache(homeDir))
  return loadPluginRegistry(homeDir).plugins.map((entry) =>
    pluginRowView(
      outdated,
      entry,
      readTextOrNull(pluginManifestPath(entry.root)),
      readTail(pluginLogPath(entry.id, homeDir)),
      readPluginSettings(entry.id, homeDir),
    ),
  )
}

/**
 * "" removes the key (manifest default applies). Takes effect on the next
 * plugin command run.
 */
export function setPluginSetting(pluginId: string, key: string, value: string, homeDir?: string): void {
  writePluginSettings(pluginId, { [key]: value }, homeDir)
}

/**
 * The daemon file-watches plugins.json, so no restart there. Engine
 * contributions are kobe-process state, so this TUI's engine table is re-read
 * too, or the selector stays stale until restart.
 */
export function setPluginEnabled(id: string, enabled: boolean, homeDir?: string): void {
  const registry = loadPluginRegistry(homeDir)
  savePluginRegistry({ plugins: registry.plugins.map((p) => (p.id === id ? { ...p, enabled } : p)) }, homeDir)
  reloadPluginEngines(homeDir)
}
