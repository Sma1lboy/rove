/**
 * Parser + validator for `rove-plugin.toml`, the Rove↔plugin contract: a
 * directory of argv commands whose API is the `rove` CLI and daemon socket.
 * Design doc: docs/design/plugins.md.
 */

import { existsSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"
import { PLUGIN_EVENT_NAMES, type PluginEventName } from "@sma1lboy/rove-plugin-sdk/contract"
import { parse as parseToml } from "smol-toml"
import {
  ManifestError,
  PLUGIN_PLATFORMS,
  type PluginPlatform,
  asCommand,
  asPlatforms,
  asSettingDefault,
  asString,
  asStringArray,
  asTableArray,
  asTimeoutMs,
  fail,
} from "./manifest-coerce.ts"
import { settingKeyRejection } from "./setting-keys.ts"

export { PLUGIN_PLATFORMS, type PluginPlatform }

/** Event catalog: ONE source in the published SDK, shared with plugin authors. */
export { PLUGIN_EVENT_NAMES, type PluginEventName }

export interface PluginCommandSpec {
  /** Argv array; never run through a shell, so no expansion. */
  readonly command: readonly string[]
  /** Item-level platform override; absent → the manifest-level list. */
  readonly platforms?: readonly PluginPlatform[]
  /**
   * Startup/event/shutdown hook deadline (ms); then the process group is
   * SIGKILLed. Absent → host default. Actions/panes have none (warning if set).
   */
  readonly timeoutMs?: number
}

export interface PluginAction extends PluginCommandSpec {
  /** Local id (no dots); globally qualified as `<plugin.id>.<action.id>`. */
  readonly id: string
  readonly title: string
}

export interface PluginEventHook extends PluginCommandSpec {
  readonly on: PluginEventName
}

/** A user-tunable setting, stored as `KEY=value` in the plugin's config `.env`. */
export interface PluginSetting {
  /** Env var name written to the config .env (conventionally ROVE_<PLUGIN>_*). */
  readonly key: string
  readonly label: string
  /** `secret` = string rendered masked (`••••`); storage is unchanged. */
  readonly type: "string" | "number" | "boolean" | "enum" | "secret"
  /** Enum choices (required for type = "enum"). */
  readonly options?: readonly string[]
  /** Default when unset. Always a string: TOML `true`/`false`/numbers store
   *  as `"1"` / absent / decimal spelling. */
  readonly default?: string
}

/** Files-pane "open" → plugin action. First enabled match wins; the action
 *  gets the absolute path as its argument. */
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
 * A plugin-contributed engine (contrib-catalog shape): launch + selector +
 * screen-rule badges only; account/history/hooks need a built-in adapter.
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
  /** Product identity for UI labels. Absent `shortName` falls back to `name`.
   *  Unknown keys in the table are ignored. */
  readonly identity?: {
    readonly shortName?: string
  }
  /**
   * How the FIRST message is delivered. `"argv"` (default) appends a
   * positional — fatal for CLIs whose positional is a subcommand or project
   * dir; those declare `"paste"` to type it into the running pane.
   */
  readonly firstMessageDelivery?: "argv" | "paste"
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
  /** Run at daemon stop; a hook outliving its grace window is killed. */
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

/**
 * Engine ids `[[engines]]` may not claim: built-in adapters + shipped contrib
 * catalog. The daemon can't import kobe's lists (kobe depends on the daemon),
 * so this is the daemon-side copy; a kobe-side test locks them together.
 */
export const RESERVED_ENGINE_IDS: readonly string[] = [
  "claude",
  "codex",
  "copilot",
  "kimi",
  "pi",
  "omp",
  "gemini",
  "opencode",
  "cursor",
  "grok",
  "droid",
  "amp",
  "devin",
  "qodercli",
  "cline",
  "kiro",
  "maki",
  "antigravity",
]

/** Canonical Rove spelling wins; the Kobe spelling is a permanent read fallback. */
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

/** ASCII letters, digits, dot, colon, underscore, hyphen. */
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

/** Parse manifest text; diagnostics name `filename` (legacy spelling included). */
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

/** Throws a `rove-plugin.toml:`-prefixed error on fatal problems; else collects `warnings`. */
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
    timeoutMs: asTimeoutMs(t.timeout_ms, `startup[${i}].timeout_ms`),
  }))
  const shutdown = asTableArray(raw.shutdown, "shutdown").map((t, i) => ({
    command: asCommand(t.command, `shutdown[${i}].command`),
    platforms: asPlatforms(t.platforms, `shutdown[${i}].platforms`),
    timeoutMs: asTimeoutMs(t.timeout_ms, `shutdown[${i}].timeout_ms`),
  }))

  const actions = asTableArray(raw.actions, "actions").map((t, i) => {
    const actionId = asString(t.id, `actions[${i}].id`)
    if (t.timeout_ms !== undefined) {
      warnings.push(
        `actions[${i}] declares \`timeout_ms\`; actions are user-invoked and are never killed on a deadline`,
      )
    }
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

  // Unknown placements (`overlay`/`popup`) warn and fall back to split.
  const panes = asTableArray(raw.panes, "panes").map((t, i) => {
    const paneId = asString(t.id, `panes[${i}].id`)
    if (!LOCAL_ID_RE.test(paneId)) fail(`pane id \`${paneId}\` may not contain dots`)
    if (t.timeout_ms !== undefined) {
      warnings.push(`panes[${i}] declares \`timeout_ms\`; a pane is a terminal the user closes, not a bounded hook`)
    }
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
      timeoutMs: asTimeoutMs(t.timeout_ms, `events[${i}].timeout_ms`),
    }
    if (!(PLUGIN_EVENT_NAMES as readonly string[]).includes(on)) {
      warnings.push(`unknown event \`${on}\`; this hook will never fire on this Rove version`)
    }
    return [hook]
  })

  const settings = asTableArray(raw.settings, "settings").map((t, i) => {
    const type = asString(t.type, `settings[${i}].type`)
    if (type !== "string" && type !== "number" && type !== "boolean" && type !== "enum" && type !== "secret") {
      fail(`settings[${i}].type must be string | number | boolean | enum | secret`)
    }
    const options =
      t.options === undefined
        ? undefined
        : Array.isArray(t.options) && t.options.every((o) => typeof o === "string" && o.length > 0)
          ? (t.options as string[])
          : fail(`settings[${i}].options must be an array of strings`)
    if (type === "enum" && (!options || options.length === 0)) fail(`settings[${i}] enum needs \`options\``)
    const settingDefault = asSettingDefault(t.default, `settings[${i}].default`)
    const key = asString(t.key, `settings[${i}].key`)
    const rejection = settingKeyRejection(key)
    if (rejection) fail(`settings[${i}].key ${rejection}`)
    return {
      key,
      label: asString(t.label, `settings[${i}].label`),
      type: type as PluginSetting["type"],
      ...(options ? { options } : {}),
      ...(settingDefault === undefined ? {} : { default: settingDefault }),
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
    // Shadowing would silently reroute launches through plugin data: fatal.
    if (RESERVED_ENGINE_IDS.includes(engineId)) {
      fail(`engine id \`${engineId}\` shadows a built-in or shipped engine`)
    }
    const rules = asTableArray(t.rules, `engines[${i}].rules`).map((r, j) => {
      const state = asString(r.state, `engines[${i}].rules[${j}].state`)
      if (state !== "working" && state !== "blocked" && state !== "idle") {
        fail(`engines[${i}].rules[${j}].state must be working | blocked | idle`)
      }
      const lineRegex = asStringArray(r.line_regex, `engines[${i}].rules[${j}].line_regex`)
      for (const re of lineRegex ?? []) {
        try {
          new RegExp(re)
        } catch {
          fail(`engines[${i}].rules[${j}].line_regex \`${re}\` is not a valid regex`)
        }
      }
      const all = asStringArray(r.all, `engines[${i}].rules[${j}].all`)
      const any = asStringArray(r.any, `engines[${i}].rules[${j}].any`)
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
      const shortName = opt("short_name")
      identity = {
        ...(shortName !== undefined ? { shortName } : {}),
      }
    }
    let firstMessageDelivery: PluginEngine["firstMessageDelivery"]
    if (t.first_message_delivery !== undefined) {
      const raw = asString(t.first_message_delivery, `engines[${i}].first_message_delivery`)
      // Fatal: a typo falling back to "argv" is the failure this key prevents.
      if (raw !== "argv" && raw !== "paste") fail(`engines[${i}].first_message_delivery must be argv | paste`)
      firstMessageDelivery = raw
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
      ...(firstMessageDelivery ? { firstMessageDelivery } : {}),
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
