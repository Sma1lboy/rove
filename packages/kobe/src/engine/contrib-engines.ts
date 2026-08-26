/**
 * Shipped contrib engines — the long tail, as DATA.
 *
 * A contrib engine is everything kobe needs to launch a coding CLI and
 * badge its activity, without a dedicated adapter: an id, a display name,
 * a launch command, and a screen-state manifest (`./screen-state.ts`).
 * No account detector, no history reader, no hook adapter — those are what
 * make an engine a BUILT-IN, and each one is real per-vendor work. A
 * contrib entry is ~10 lines; a future plugin registers exactly this shape.
 *
 * Selection gating: a contrib engine appears in the new-task selector only
 * when its binary is on PATH (`account-detect.ts` probes `defaultCommand[0]`
 * with the same generic `which` the custom-engine launch would hit anyway),
 * so shipping the catalog costs users without these CLIs nothing.
 *
 * Screen manifests are adapted from refs/herdr's agent-detection rules
 * (src/detect/manifests/*.toml, studied with attribution), reduced to the
 * classifier's vocabulary. Blocked rules go before working rules.
 */

import type { EngineIdentity } from "@/types/engine"
import type { EngineRegistryEntry } from "./registry.ts"
import type { EngineScreenManifest } from "./screen-state.ts"

export interface ContribEngineSpec {
  readonly displayName: string
  readonly defaultCommand: readonly string[]
  readonly processNames?: readonly string[]
  readonly screenManifest: EngineScreenManifest
  /** Plugin-declared product identity (composer placeholder etc.). */
  readonly identity?: EngineIdentity
}

/**
 * Plugin-contributed engines, registered at process start from enabled
 * plugin manifests' `[[engines]]` tables (`./plugin-engines.ts` reads +
 * translates; this module only holds the table so `registry.ts` stays
 * import-cycle-free and state-free). Shipped catalog ids and built-ins win
 * over a same-named plugin engine — registration skips those.
 */
const pluginEngines = new Map<string, ContribEngineSpec>()

export function registerPluginEngine(id: string, spec: ContribEngineSpec): boolean {
  if (Object.hasOwn(CONTRIB_ENGINES, id)) return false
  pluginEngines.set(id, spec)
  return true
}

/** Test seam: drop all plugin-registered engines. */
export function clearPluginEngines(): void {
  pluginEngines.clear()
}

export function pluginEngineIds(): readonly string[] {
  return [...pluginEngines.keys()]
}

const GEMINI: EngineScreenManifest = {
  rules: [
    { state: "blocked", any: ["│ apply this change", "│ allow execution", "waiting for user confirmation"] },
    { state: "blocked", all: ["do you want to proceed"], any: ["yes"] },
    { state: "working", any: ["esc to cancel"] },
  ],
}

const OPENCODE: EngineScreenManifest = {
  rules: [
    { state: "blocked", any: ["△ permission required"] },
    { state: "blocked", all: ["esc dismiss"], any: ["enter confirm", "enter submit", "enter toggle"] },
    { state: "working", any: ["esc to interrupt", "ctrl+c to interrupt", "esc again to interrupt"] },
  ],
}

const CURSOR: EngineScreenManifest = {
  rules: [
    { state: "blocked", all: ["proceed (y)"] },
    { state: "blocked", any: ["run this command?", "waiting for approval", "skip (esc or n)", "(y) (enter)"] },
    { state: "working", any: ["esc to cancel", "ctrl+c to stop"] },
  ],
}

const GROK: EngineScreenManifest = {
  rules: [
    // Permission / question dialogs draw a "┃"-guttered option list with a
    // select footer; the ⚠ prefix rides the OSC title too but the pane copy
    // is the portable signal.
    { state: "blocked", any: ["⚠ action required", "ctrl+o:yolo"] },
    { state: "blocked", all: ["┃"], lineRegex: ["^\\s*┃\\s+\\S+\\s+\\(○\\)"] },
    // A working turn anchors on the [stop] chip (the startup splash draws
    // its logo in braille, so a bare spinner glyph is not usable).
    { state: "working", any: ["[stop]"], lineRegex: ["^\\s*[\\u2800-\\u28FF]"] },
  ],
}

const DROID: EngineScreenManifest = {
  rules: [
    { state: "blocked", all: ["enter to select", "esc to cancel"], any: ["> yes, allow", "> no, cancel"] },
    { state: "blocked", all: ["enter select", "esc cancel"] },
    { state: "working", any: ["esc to stop"] },
  ],
}

const AMP: EngineScreenManifest = {
  rules: [
    {
      state: "blocked",
      any: [
        "waiting for approval",
        "run this command?",
        "allow editing file:",
        "allow creating file:",
        "confirm tool call",
      ],
    },
    { state: "working", lineRegex: ["^\\s*╰\\s+\\S+\\s+(thinking|streaming|running tools|waiting)\\s+─"] },
  ],
}

/** The shipped catalog. Key = the engine's VendorId. */
export const CONTRIB_ENGINES: Record<string, ContribEngineSpec> = {
  gemini: { displayName: "Gemini CLI", defaultCommand: ["gemini"], screenManifest: GEMINI },
  opencode: { displayName: "OpenCode", defaultCommand: ["opencode"], screenManifest: OPENCODE },
  cursor: { displayName: "Cursor Agent", defaultCommand: ["cursor-agent"], screenManifest: CURSOR },
  grok: { displayName: "Grok CLI", defaultCommand: ["grok"], screenManifest: GROK },
  droid: { displayName: "Droid", defaultCommand: ["droid"], screenManifest: DROID },
  amp: { displayName: "Amp", defaultCommand: ["amp"], screenManifest: AMP },
}

export function isContribEngine(id: string): boolean {
  return Object.hasOwn(CONTRIB_ENGINES, id) || pluginEngines.has(id)
}

export const CONTRIB_ENGINE_IDS: readonly string[] = Object.keys(CONTRIB_ENGINES)

/**
 * Fill a contrib spec into a full registry entry. The base is the caller's
 * empty custom entry (registry.ts owns that shape and passes it in — this
 * module must not import registry.ts back, the entry type is imported
 * type-only), overlaid with the contrib's identity + manifest.
 */
export function contribEngineEntry(id: string, base: EngineRegistryEntry): EngineRegistryEntry {
  const spec = CONTRIB_ENGINES[id] ?? pluginEngines.get(id)
  if (!spec) return base
  return {
    ...base,
    displayName: spec.displayName,
    defaultCommand: spec.defaultCommand,
    ...(spec.processNames ? { processNames: spec.processNames } : {}),
    screenManifest: spec.screenManifest,
    ...(spec.identity ? { identity: spec.identity } : {}),
  }
}
