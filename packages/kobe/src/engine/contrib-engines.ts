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
  /**
   * How this CLI accepts a session's FIRST message — same field the built-in
   * table declares (see `registry.ts`). Contrib entries otherwise inherit the
   * `"argv"` default, which appends the prompt as a positional; declare
   * `"paste"` when the positional slot means something else, or the launch
   * dies on the prompt text.
   */
  readonly firstMessageDelivery?: "argv" | "paste"
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

// Footer vocabulary verified against opencode 0.6.3 on 2026-09-04: a running
// turn ends `…working...  esc interrupt` and a resting one `enter send`.
// `esc interrupt` is the string copilot's manifest already carries; the
// `esc to interrupt` spellings are kept so an older opencode still matches.
const OPENCODE: EngineScreenManifest = {
  rules: [
    { state: "blocked", any: ["△ permission required"] },
    { state: "blocked", all: ["esc dismiss"], any: ["enter confirm", "enter submit", "enter toggle"] },
    { state: "working", any: ["esc interrupt", "esc to interrupt", "ctrl+c to interrupt", "esc again to interrupt"] },
    // The rest footer, LAST so a running turn (which draws `enter send` too)
    // still reads working. Without an idle rule the badge that finally lights
    // up on the rule above could never come back down.
    { state: "idle", any: ["enter send"] },
  ],
}

const CURSOR: EngineScreenManifest = {
  rules: [
    // The login wall, captured from cursor-agent 2026.04.17 in a fresh git
    // directory. Without this rule an unauthenticated cursor task classifies
    // exactly like a healthy resting one — no rule matches either, the
    // classifier answers null, and the badge stays wherever it was. A task
    // that CANNOT RUN AT ALL is blocked on a human, which is what this state
    // means everywhere else, so it gets the same "go look at it" badge rather
    // than a new vocabulary.
    { state: "blocked", any: ["press any key to log in"] },
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
  // opencode's positional is a project DIRECTORY ("Positionals: project  path
  // to start opencode in"), so an argv-delivered first message becomes a path:
  // `opencode "Run the shell command: ls -la"` exits with
  // `Failed to change directory to <cwd>/Run the shell command: ls -la`.
  // Verified against opencode 0.6.3 on 2026-09-04. The other catalog entries
  // keep the "argv" default — their positional semantics are UNVERIFIED here
  // (binaries absent from the machine this was checked on).
  opencode: {
    displayName: "OpenCode",
    defaultCommand: ["opencode"],
    screenManifest: OPENCODE,
    firstMessageDelivery: "paste",
  },
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
    ...(spec.firstMessageDelivery ? { firstMessageDelivery: spec.firstMessageDelivery } : {}),
  }
}
