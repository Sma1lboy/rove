/**
 * `rove-plugin.toml` — the canonical contract between Rove and a plugin.
 *
 * A plugin is a directory with this manifest plus argv commands Rove can
 * launch; the whole `rove` CLI (and the daemon
 * socket) is the plugin API. The manifest shape is deliberately isomorphic
 * to herdr's `herdr-plugin.toml` ([[build]] / [[startup]] / [[actions]] /
 * [[events]]) so porting a plugin between the two ecosystems is a rename
 * plus swapping the callback CLI. Design doc: docs/design/plugins.md.
 */

import { existsSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"
import { PLUGIN_EVENT_NAMES, type PluginEventName } from "@sma1lboy/rove-plugin-sdk/contract"
import { parse as parseToml } from "smol-toml"

export type PluginPlatform = "macos" | "linux" | "windows"

export const PLUGIN_PLATFORMS: readonly PluginPlatform[] = ["macos", "linux", "windows"]

/** The event catalog lives in the published SDK's contract module — ONE
 *  source shared by the daemon and external plugin authors (catalog docs:
 *  docs/design/plugin-events.md; dispatch: plugins/events.ts). */
export { PLUGIN_EVENT_NAMES, type PluginEventName }

export interface PluginCommandSpec {
  /** Argv array; never run through a shell, so no expansion. */
  readonly command: readonly string[]
  /** Item-level platform override; absent → the manifest-level list. */
  readonly platforms?: readonly PluginPlatform[]
}

export interface PluginAction extends PluginCommandSpec {
  /** Local id (no dots); globally qualified as `<plugin.id>.<action.id>`. */
  readonly id: string
  readonly title: string
}

export interface PluginEventHook extends PluginCommandSpec {
  readonly on: PluginEventName
}

/** One user-tunable setting: declared here, edited in Settings → Plugins,
 *  stored as `KEY=value` in the plugin's config `.env` (the contract plugin
 *  commands already source). */
export interface PluginSetting {
  /** Env var name written to the config .env (conventionally ROVE_<PLUGIN>_*). */
  readonly key: string
  readonly label: string
  readonly type: "string" | "number" | "boolean" | "enum"
  /** Enum choices (required for type = "enum"). */
  readonly options?: readonly string[]
  /** Default shown when the .env has no value; storage is always a string. */
  readonly default?: string
}

/** Route "open this file" from the Files pane to a plugin action: the first
 *  enabled handler whose pattern matches the file name wins; the action
 *  receives the absolute path as its argument. */
export interface PluginFileHandler {
  /** JS regex source tested against the file's name/path. */
  readonly pattern: string
  /** Local action id in this plugin. */
  readonly action: string
}

export interface PluginPane extends PluginCommandSpec {
  /** Local id (no dots), like actions. */
  readonly id: string
  readonly title: string
  /** `split` (default) joins the focused chattab's split group; `tab` opens
   *  a separate self-closing command tab. */
  readonly placement: "split" | "tab"
}

/**
 * One coding-CLI engine a plugin contributes (docs/design/plugin-events.md
 * follow-up; same shape as kobe's shipped contrib-engine catalog): identity +
 * launch command + declarative screen-state rules. The TUI overlays this onto
 * the empty custom registry entry — launch + selector + screen-based badges,
 * no account/history/hook surfaces (those require a built-in adapter).
 */
export interface PluginEngineRule {
  readonly state: "working" | "blocked" | "idle"
  readonly bottomLines?: number
  readonly all?: readonly string[]
  readonly any?: readonly string[]
  readonly lineRegex?: readonly string[]
}

export interface PluginEngine {
  /** Engine id (VendorId); may not shadow a built-in. Same alphabet as actions. */
  readonly id: string
  readonly name: string
  /** Launch argv; argv[0] is also the binary probed for selector gating. */
  readonly command: readonly string[]
  /** Extra `ps` basenames a live process may show as (post-launch renames). */
  readonly processNames?: readonly string[]
  /** Screen-state rules, first match wins (declare blocked before working). */
  readonly rules: readonly PluginEngineRule[]
  /** Product identity for UI copy (composer placeholder, labels). Absent
   *  fields fall back to `name`/id derivations. */
  readonly identity?: {
    readonly productName?: string
    readonly shortName?: string
    readonly assistantName?: string
    readonly inputPlaceholder?: string
  }
}

export interface PluginManifest {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly minKobeVersion: string
  readonly description?: string
  readonly platforms?: readonly PluginPlatform[]
  readonly build: readonly PluginCommandSpec[]
  readonly startup: readonly PluginCommandSpec[]
  /** Run at daemon stop (bounded — the host kills a hook that outlives its
   *  grace window rather than delaying shutdown). */
  readonly shutdown: readonly PluginCommandSpec[]
  readonly actions: readonly PluginAction[]
  readonly events: readonly PluginEventHook[]
  readonly panes: readonly PluginPane[]
  readonly settings: readonly PluginSetting[]
  readonly fileHandlers: readonly PluginFileHandler[]
  readonly engines: readonly PluginEngine[]
}

export interface ParsedPluginManifest {
  readonly manifest: PluginManifest
  /** Non-fatal issues (unknown event names, missing platforms declaration). */
  readonly warnings: readonly string[]
}

export const PLUGIN_MANIFEST_FILENAME = "rove-plugin.toml"
export const LEGACY_PLUGIN_MANIFEST_FILENAME = "kobe-plugin.toml"
export const PLUGIN_MANIFEST_FILENAMES = [PLUGIN_MANIFEST_FILENAME, LEGACY_PLUGIN_MANIFEST_FILENAME] as const

/** Resolve a plugin manifest with the canonical Rove spelling winning when
 * both files exist. The Kobe spelling remains a permanent read fallback. */
export function pluginManifestPath(root: string): string | null {
  for (const filename of PLUGIN_MANIFEST_FILENAMES) {
    const path = join(root, filename)
    if (existsSync(path)) return path
  }
  return null
}

/** Read and parse either supported manifest spelling from a plugin root. */
export function readPluginManifest(root: string): ParsedPluginManifest {
  const path = pluginManifestPath(root)
  if (!path) throw new ManifestError(`no ${PLUGIN_MANIFEST_FILENAMES.join(" or ")} found at ${root}`)
  return parsePluginManifest(readFileSync(path, "utf8"), basename(path))
}

/** ASCII letters, digits, dot, colon, underscore, hyphen — same as herdr. */
const PLUGIN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
/** Local ids (actions): same alphabet minus dots, so qualified names split cleanly. */
const LOCAL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_:-]*$/

export function qualifiedActionId(pluginId: string, actionId: string): string {
  return `${pluginId}.${actionId}`
}

/** Map `process.platform` onto manifest platform tokens. */
export function currentPluginPlatform(platform: NodeJS.Platform = process.platform): PluginPlatform | undefined {
  if (platform === "darwin") return "macos"
  if (platform === "linux") return "linux"
  if (platform === "win32") return "windows"
  return undefined
}

/** Whether an item (or the whole plugin) is declared to run on `platform`. */
export function supportsPlatform(
  item: { platforms?: readonly PluginPlatform[] },
  manifest: Pick<PluginManifest, "platforms">,
  platform: PluginPlatform | undefined,
): boolean {
  const declared = item.platforms ?? manifest.platforms
  if (!declared) return true
  return platform !== undefined && declared.includes(platform)
}

class ManifestError extends Error {}

function fail(message: string): never {
  throw new ManifestError(`rove-plugin.toml: ${message}`)
}

/** Parse manifest text while preserving the source filename in diagnostics.
 * Direct callers default to the canonical filename; file readers pass the
 * actual basename so legacy manifests remain debuggable. */
export function parsePluginManifest(text: string, filename: string = PLUGIN_MANIFEST_FILENAME): ParsedPluginManifest {
  try {
    return parseCanonicalPluginManifest(text)
  } catch (err) {
    if (filename !== PLUGIN_MANIFEST_FILENAME && err instanceof ManifestError) {
      throw new ManifestError(err.message.replace(/^rove-plugin\.toml:/, `${filename}:`))
    }
    throw err
  }
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) fail(`\`${field}\` must be a non-empty string`)
  return value
}

function asCommand(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === "string" && v.length > 0)) {
    fail(`\`${field}\` must be a non-empty array of strings (argv form)`)
  }
  return value
}

function asPlatforms(value: unknown, field: string): PluginPlatform[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((v) => (PLUGIN_PLATFORMS as readonly string[]).includes(v as string))) {
    fail(`\`${field}\` must be an array drawn from ${PLUGIN_PLATFORMS.join(", ")}`)
  }
  return value as PluginPlatform[]
}

function asTableArray(value: unknown, field: string): Record<string, unknown>[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((v) => typeof v === "object" && v !== null && !Array.isArray(v))) {
    fail(`\`[[${field}]]\` must be an array of tables`)
  }
  return value as Record<string, unknown>[]
}

/**
 * Parse + validate manifest text. Throws with a `rove-plugin.toml:`-prefixed
 * message on a fatal problem; collects non-fatal issues into `warnings`.
 */
function parseCanonicalPluginManifest(text: string): ParsedPluginManifest {
  let raw: Record<string, unknown>
  try {
    raw = parseToml(text)
  } catch (err) {
    fail(`invalid TOML — ${err instanceof Error ? err.message : String(err)}`)
  }
  const warnings: string[] = []

  const id = asString(raw.id, "id")
  if (!PLUGIN_ID_RE.test(id)) fail(`plugin id \`${id}\` may use ASCII letters, digits, dot, colon, underscore, hyphen`)
  const name = asString(raw.name, "name")
  const version = asString(raw.version, "version")
  const rawMinVersion = raw.min_rove_version ?? raw.min_kobe_version
  const minKobeVersion = asString(rawMinVersion, "min_rove_version")
  const description = raw.description === undefined ? undefined : asString(raw.description, "description")
  const platforms = asPlatforms(raw.platforms, "platforms")
  if (!platforms) warnings.push("no top-level `platforms` declared; assuming the plugin runs everywhere")
  if (
    raw.min_rove_version !== undefined &&
    raw.min_kobe_version !== undefined &&
    raw.min_rove_version !== raw.min_kobe_version
  ) {
    warnings.push("both `min_rove_version` and legacy `min_kobe_version` are set; using `min_rove_version`")
  }

  const build = asTableArray(raw.build, "build").map((t, i) => ({
    command: asCommand(t.command, `build[${i}].command`),
    platforms: asPlatforms(t.platforms, `build[${i}].platforms`),
  }))
  const startup = asTableArray(raw.startup, "startup").map((t, i) => ({
    command: asCommand(t.command, `startup[${i}].command`),
    platforms: asPlatforms(t.platforms, `startup[${i}].platforms`),
  }))
  const shutdown = asTableArray(raw.shutdown, "shutdown").map((t, i) => ({
    command: asCommand(t.command, `shutdown[${i}].command`),
    platforms: asPlatforms(t.platforms, `shutdown[${i}].platforms`),
  }))

  const actions = asTableArray(raw.actions, "actions").map((t, i) => {
    const actionId = asString(t.id, `actions[${i}].id`)
    if (!LOCAL_ID_RE.test(actionId)) fail(`action id \`${actionId}\` may not contain dots`)
    return {
      id: actionId,
      title: asString(t.title, `actions[${i}].title`),
      command: asCommand(t.command, `actions[${i}].command`),
      platforms: asPlatforms(t.platforms, `actions[${i}].platforms`),
    }
  })
  const seen = new Set<string>()
  for (const a of actions) {
    if (seen.has(a.id)) fail(`duplicate action id \`${a.id}\``)
    seen.add(a.id)
  }

  // Panes join the focused chattab's split group by default (`split`), or
  // open a separate command tab (`tab`); herdr-style overlay/popup are
  // tolerated with a warning and treated as split.
  const panes = asTableArray(raw.panes, "panes").map((t, i) => {
    const paneId = asString(t.id, `panes[${i}].id`)
    if (!LOCAL_ID_RE.test(paneId)) fail(`pane id \`${paneId}\` may not contain dots`)
    if (t.placement !== undefined && t.placement !== "tab" && t.placement !== "split") {
      warnings.push(`pane \`${paneId}\` placement \`${String(t.placement)}\` is not supported yet; opening as a split`)
    }
    return {
      id: paneId,
      title: asString(t.title, `panes[${i}].title`),
      placement: (t.placement === "tab" ? "tab" : "split") as "split" | "tab",
      command: asCommand(t.command, `panes[${i}].command`),
      platforms: asPlatforms(t.platforms, `panes[${i}].platforms`),
    }
  })
  const paneSeen = new Set<string>()
  for (const p of panes) {
    if (paneSeen.has(p.id)) fail(`duplicate pane id \`${p.id}\``)
    paneSeen.add(p.id)
  }

  const events = asTableArray(raw.events, "events").flatMap((t, i) => {
    const on = asString(t.on, `events[${i}].on`)
    const hook = {
      on: on as PluginEventName,
      command: asCommand(t.command, `events[${i}].command`),
      platforms: asPlatforms(t.platforms, `events[${i}].platforms`),
    }
    if (!(PLUGIN_EVENT_NAMES as readonly string[]).includes(on)) {
      warnings.push(`unknown event \`${on}\`; this hook will never fire on this Rove version`)
    }
    return [hook]
  })

  const settings = asTableArray(raw.settings, "settings").map((t, i) => {
    const type = asString(t.type, `settings[${i}].type`)
    if (type !== "string" && type !== "number" && type !== "boolean" && type !== "enum") {
      fail(`settings[${i}].type must be string | number | boolean | enum`)
    }
    const options =
      t.options === undefined
        ? undefined
        : Array.isArray(t.options) && t.options.every((o) => typeof o === "string" && o.length > 0)
          ? (t.options as string[])
          : fail(`settings[${i}].options must be an array of strings`)
    if (type === "enum" && (!options || options.length === 0)) fail(`settings[${i}] enum needs \`options\``)
    return {
      key: asString(t.key, `settings[${i}].key`),
      label: asString(t.label, `settings[${i}].label`),
      type: type as "string" | "number" | "boolean" | "enum",
      ...(options ? { options } : {}),
      ...(t.default === undefined ? {} : { default: asString(t.default, `settings[${i}].default`) }),
    }
  })

  const fileHandlers = asTableArray(raw.file_handlers, "file_handlers").map((t, i) => {
    const pattern = asString(t.pattern, `file_handlers[${i}].pattern`)
    try {
      new RegExp(pattern)
    } catch {
      fail(`file_handlers[${i}].pattern is not a valid regex`)
    }
    const action = asString(t.action, `file_handlers[${i}].action`)
    if (!actions.some((a) => a.id === action)) fail(`file_handlers[${i}] names unknown action \`${action}\``)
    return { pattern, action }
  })

  const engines = asTableArray(raw.engines, "engines").map((t, i) => {
    const engineId = asString(t.id, `engines[${i}].id`)
    if (!LOCAL_ID_RE.test(engineId)) fail(`engine id \`${engineId}\` may not contain dots`)
    // Shadowing a first-party engine would silently reroute claude/codex
    // launches through plugin data — always a mistake, always fatal.
    if (["claude", "codex", "copilot", "kimi"].includes(engineId)) {
      fail(`engine id \`${engineId}\` shadows a built-in engine`)
    }
    const rules = asTableArray(t.rules, `engines[${i}].rules`).map((r, j) => {
      const state = asString(r.state, `engines[${i}].rules[${j}].state`)
      if (state !== "working" && state !== "blocked" && state !== "idle") {
        fail(`engines[${i}].rules[${j}].state must be working | blocked | idle`)
      }
      const strings = (value: unknown, field: string): string[] | undefined => {
        if (value === undefined) return undefined
        if (!Array.isArray(value) || !value.every((v) => typeof v === "string" && v.length > 0)) {
          fail(`\`${field}\` must be a non-empty array of strings`)
        }
        return value as string[]
      }
      const lineRegex = strings(r.line_regex, `engines[${i}].rules[${j}].line_regex`)
      for (const re of lineRegex ?? []) {
        try {
          new RegExp(re)
        } catch {
          fail(`engines[${i}].rules[${j}].line_regex \`${re}\` is not a valid regex`)
        }
      }
      const all = strings(r.all, `engines[${i}].rules[${j}].all`)
      const any = strings(r.any, `engines[${i}].rules[${j}].any`)
      if (!all && !any && !lineRegex) fail(`engines[${i}].rules[${j}] needs at least one of all/any/line_regex`)
      return {
        state: state as "working" | "blocked" | "idle",
        ...(typeof r.bottom_lines === "number" ? { bottomLines: r.bottom_lines } : {}),
        ...(all ? { all } : {}),
        ...(any ? { any } : {}),
        ...(lineRegex ? { lineRegex } : {}),
      }
    })
    const identityRaw = t.identity
    let identity: PluginEngine["identity"]
    if (identityRaw !== undefined) {
      if (typeof identityRaw !== "object" || identityRaw === null || Array.isArray(identityRaw)) {
        fail(`engines[${i}].identity must be a table`)
      }
      const idt = identityRaw as Record<string, unknown>
      const opt = (key: string): string | undefined =>
        idt[key] === undefined ? undefined : asString(idt[key], `engines[${i}].identity.${key}`)
      identity = {
        ...(opt("product_name") !== undefined ? { productName: opt("product_name") } : {}),
        ...(opt("short_name") !== undefined ? { shortName: opt("short_name") } : {}),
        ...(opt("assistant_name") !== undefined ? { assistantName: opt("assistant_name") } : {}),
        ...(opt("input_placeholder") !== undefined ? { inputPlaceholder: opt("input_placeholder") } : {}),
      }
    }
    return {
      id: engineId,
      name: asString(t.name, `engines[${i}].name`),
      command: asCommand(t.command, `engines[${i}].command`),
      ...(t.process_names === undefined
        ? {}
        : { processNames: asCommand(t.process_names, `engines[${i}].process_names`) }),
      rules,
      ...(identity ? { identity } : {}),
    }
  })
  const engineSeen = new Set<string>()
  for (const e of engines) {
    if (engineSeen.has(e.id)) fail(`duplicate engine id \`${e.id}\``)
    engineSeen.add(e.id)
  }

  return {
    manifest: {
      id,
      name,
      version,
      minKobeVersion,
      description,
      platforms,
      build,
      startup,
      shutdown,
      actions,
      events,
      panes,
      settings,
      fileHandlers,
      engines,
    },
    warnings,
  }
}
