/**
 * Shipped contrib engines as DATA: id, display name, launch command and a
 * screen-state manifest (`./screen-state.ts`). No account detector or history
 * reader — those make an engine a BUILT-IN. A hook adapter is the one optional
 * extra, since installing a hook needs nothing else from a built-in. Plugins
 * register exactly this shape.
 *
 * A contrib engine appears in the new-task selector only when
 * `defaultCommand[0]` is on PATH (`account-detect.ts`), so the catalog costs
 * users without these CLIs nothing. Blocked rules go before working rules.
 */

import type { EngineIdentity } from "@/types/engine"
import { CursorHookAdapter } from "./cursor-local/hook-adapter.ts"
import { DevinHookAdapter } from "./devin-local/hook-adapter.ts"
import { DroidHookAdapter } from "./droid-local/hook-adapter.ts"
import type { EngineHookAdapter } from "./hook-adapter.ts"
import { QodercliHookAdapter } from "./qodercli-local/hook-adapter.ts"
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
   * How the CLI accepts a session's FIRST message (see `registry.ts`). The
   * `"argv"` default appends it as a positional; declare `"paste"` when the
   * positional means something else, or the launch dies on the prompt text.
   */
  readonly firstMessageDelivery?: "argv" | "paste"
  /**
   * Optional activity-hook installer. Without it the entry keeps the base's
   * `NoopHookAdapter`: screen-only, no install, no warning, no file written.
   * It does NOT replace {@link screenManifest}: the hook reports session
   * identity, the manifest keeps reporting state.
   */
  readonly createHookAdapter?: () => EngineHookAdapter
}

/**
 * Plugin engines from enabled manifests' `[[engines]]` tables, held here so
 * `registry.ts` stays import-cycle-free and state-free. Shipped catalog ids and
 * built-ins win over a same-named plugin engine.
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

// Verified against opencode 0.6.3: a running turn ends `…working...  esc
// interrupt`, a resting one `enter send`. `esc to interrupt` covers older builds.
const OPENCODE: EngineScreenManifest = {
  rules: [
    { state: "blocked", any: ["△ permission required"] },
    { state: "blocked", all: ["esc dismiss"], any: ["enter confirm", "enter submit", "enter toggle"] },
    { state: "working", any: ["esc interrupt", "esc to interrupt", "ctrl+c to interrupt", "esc again to interrupt"] },
    // LAST: a running turn draws `enter send` too. Without it the badge never clears.
    { state: "idle", any: ["enter send"] },
  ],
}

const CURSOR: EngineScreenManifest = {
  rules: [
    // Login wall (cursor-agent 2026.04.17). Without it an unauthenticated task
    // classifies null like a resting one; a task that cannot run is blocked on a human.
    { state: "blocked", any: ["press any key to log in"] },
    { state: "blocked", all: ["proceed (y)"] },
    { state: "blocked", any: ["run this command?", "waiting for approval", "skip (esc or n)", "(y) (enter)"] },
    { state: "working", any: ["esc to cancel", "ctrl+c to stop"] },
  ],
}

const GROK: EngineScreenManifest = {
  rules: [
    // Dialogs draw a "┃"-guttered option list; the ⚠ also rides the OSC title
    // but the pane copy is the portable signal.
    { state: "blocked", any: ["⚠ action required", "ctrl+o:yolo"] },
    { state: "blocked", all: ["┃"], lineRegex: ["^\\s*┃\\s+\\S+\\s+\\(○\\)"] },
    // Anchor on [stop]: the startup splash draws its logo in braille.
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

// ── Screen-only engines (no hook, no history) ──────────────────────────────
// The pane is the ONLY state source for the four below. The rule model lacks:
//   - OR-of-ANDs: each conjunctive disjunct becomes its own same-state rule
//     (first match wins, so N same-state rules ARE an OR).
//   - `not` gates: a rule that needs one is dropped, noted below.
// A whole-screen region collapses to the default bottom 12 non-empty lines, so
// a taller dialog is missed — the safe direction, since a false `blocked`
// keeps the attention inbox lit. `\p{Alphabetic}` becomes `[A-Za-z]`: patterns
// compile without the `u` flag, so a non-Latin word after a spinner won't match.

// Blocked-only: a catch-all "non-empty screen is working" rule would pin the
// badge to running forever, and `null` (keep the previous reading) is honest
// until someone captures cline's real working/resting footer.
const CLINE: EngineScreenManifest = {
  rules: [
    { state: "blocked", any: ["let cline use this tool"] },
    // The [act mode]/[plan mode] × command/tool cross product.
    { state: "blocked", all: ["execute command?", "yes"], any: ["[act mode]", "[plan mode]"] },
    { state: "blocked", all: ["use this tool?", "yes"], any: ["[act mode]", "[plan mode]"] },
  ],
}

const KIRO: EngineScreenManifest = {
  rules: [
    {
      state: "blocked",
      all: ["requires approval"],
      any: ["yes, single permission", "trust, always allow", "no (tab to edit)", "esc to close"],
    },
    // "tool approval" is a prefix of "tool approvals", so one substring covers both.
    {
      state: "blocked",
      all: ["pending from subagents", "tool approval"],
      any: ["approve all pending", "configure individually", "exit (cancel subagents)"],
    },
    { state: "working", any: ["kiro is working"] },
    { state: "working", all: ["esc to cancel"], lineRegex: ["^\\s*[◔◑◕●]\\s+[A-Za-z]"] },
  ],
}

// Maki's bottom-row status bar shows `[BUILD]`/`[PLAN]`/`[BASH]`, with a leading
// braille cell while streaming — hence `bottomLines: 1`. DROPPED: the narrow-pane
// `prompt_box_idle` fallback (bare `❯ `) needs two `not` gates; ungated it reads
// a streaming maki as idle, so a narrow pane reports `null` instead.
const MAKI: EngineScreenManifest = {
  rules: [
    // Maki's permission screen has four alternatives, two of them
    // conjunctions — one rule each.
    { state: "blocked", all: ["permission required", "y allow", "n deny"] },
    { state: "blocked", all: ["permission required"], any: ["confirm allow", "confirm deny"] },
    { state: "blocked", all: ["permission required", "enter deny", "esc cancel"] },
    { state: "blocked", all: ["plan complete", "enter confirm"], any: ["space toggle parallel", "edit plan"] },
    { state: "working", bottomLines: 1, lineRegex: ["^( [\\u2800-\\u28FF]){1,2} \\[(BUILD|PLAN|BASH)\\]"] },
    { state: "idle", bottomLines: 1, lineRegex: ["^ \\[(BUILD|PLAN|BASH)\\]"] },
  ],
}

// Antigravity's manifest id is "agy", not its command name.
const ANTIGRAVITY: EngineScreenManifest = {
  rules: [
    { state: "blocked", all: ["requesting permission for:", "do you want to proceed?"] },
    { state: "blocked", all: ["requesting permission for:", "tab amend", "edit command"] },
    { state: "working", lineRegex: ["^\\s*[\\u2800-\\u28FF]+\\s+[A-Za-z]+\\w*ing\\b"] },
    { state: "working", bottomLines: 5, lineRegex: ["·\\s*[1-9][0-9]*\\s+task"] },
  ],
}

// Order stands in for `not`: the negations working/idle need only exclude the
// rules ABOVE them, and first match wins.
const DEVIN: EngineScreenManifest = {
  rules: [
    { state: "blocked", bottomLines: 8, all: ["do you trust the authors of this directory?", "yes, trust "] },
    { state: "blocked", bottomLines: 8, all: ["approve once", "select", "confirm", "esc cancel"] },
    { state: "working", bottomLines: 8, all: ["running tools", "esc to interrupt"] },
    { state: "working", bottomLines: 6, all: ["guide devin while it works"] },
    { state: "working", bottomLines: 8, all: ["reading shell ", "timeout:"] },
    {
      state: "idle",
      bottomLines: 8,
      all: ["ask devin to build", "features, fix bugs", "your code"],
      lineRegex: ["^\\s*\u276d Ask Devin to build"],
    },
    { state: "idle", bottomLines: 6, all: ["context:"], lineRegex: ["^\\s*\u276d"] },
  ],
}

// Each conjunctive blocked alternative gets its own rule: its `any` slot holds
// the conjunction's second half.
const QODERCLI: EngineScreenManifest = {
  rules: [
    { state: "blocked", all: ["waiting for user confirmation"], any: ["yes", "no", "allow", "reject"] },
    { state: "blocked", all: ["awaiting approval"], any: ["allow", "reject"] },
    {
      state: "blocked",
      any: [
        "permission required",
        "allow once or always?",
        "asking user",
        "enter your response",
        "review your answers:",
        "shell awaiting input",
      ],
    },
    { state: "working", any: ["(esc to cancel,"] },
    { state: "working", lineRegex: ["^\\s*[\\u2800-\\u28FF]\\s+.*[A-Za-z]"] },
  ],
}

/** The shipped catalog. Key = the engine's VendorId. */
export const CONTRIB_ENGINES: Record<string, ContribEngineSpec> = {
  gemini: { displayName: "Gemini CLI", defaultCommand: ["gemini"], screenManifest: GEMINI },
  // opencode's positional is a project DIRECTORY: an argv first message exits
  // `Failed to change directory to <cwd>/<prompt>` (opencode 0.6.3). Other
  // entries keep "argv" with positional semantics UNVERIFIED.
  opencode: {
    displayName: "OpenCode",
    defaultCommand: ["opencode"],
    screenManifest: OPENCODE,
    firstMessageDelivery: "paste",
  },
  cursor: {
    displayName: "Cursor Agent",
    defaultCommand: ["cursor-agent"],
    screenManifest: CURSOR,
    createHookAdapter: () => new CursorHookAdapter(),
  },
  grok: { displayName: "Grok CLI", defaultCommand: ["grok"], screenManifest: GROK },
  droid: {
    displayName: "Droid",
    defaultCommand: ["droid"],
    screenManifest: DROID,
    createHookAdapter: () => new DroidHookAdapter(),
  },
  amp: { displayName: "Amp", defaultCommand: ["amp"], screenManifest: AMP },
  // The hook's `SessionStart` reports the live session; the manifest owns
  // working/blocked/idle. Screen strings are uncaptured (CLI not installed
  // when written), and "argv" delivery is UNVERIFIED.
  devin: {
    displayName: "Devin",
    defaultCommand: ["devin"],
    processNames: ["devin-cli"],
    screenManifest: DEVIN,
    createHookAdapter: () => new DevinHookAdapter(),
  },
  qodercli: {
    displayName: "Qoder CLI",
    defaultCommand: ["qodercli"],
    processNames: ["qoder", "qoderclicn", "qodercn"],
    screenManifest: QODERCLI,
    createHookAdapter: () => new QodercliHookAdapter(),
  },
  // Commands are each CLI's executable, not the manifest id (kiro → `kiro-cli`).
  // `processNames` maps other process spellings back (`foreground.ts`). Screen
  // strings are uncaptured and "argv" delivery is UNVERIFIED for these four.
  cline: { displayName: "Cline", defaultCommand: ["cline"], screenManifest: CLINE },
  kiro: { displayName: "Kiro CLI", defaultCommand: ["kiro-cli"], processNames: ["kiro"], screenManifest: KIRO },
  maki: { displayName: "Maki", defaultCommand: ["maki"], screenManifest: MAKI },
  antigravity: {
    displayName: "Antigravity",
    defaultCommand: ["agy"],
    processNames: ["antigravity", "antigravity-cli"],
    screenManifest: ANTIGRAVITY,
  },
}

export function isContribEngine(id: string): boolean {
  return Object.hasOwn(CONTRIB_ENGINES, id) || pluginEngines.has(id)
}

export const CONTRIB_ENGINE_IDS: readonly string[] = Object.keys(CONTRIB_ENGINES)

/**
 * Overlay a contrib spec on the caller's empty custom entry. `base` is passed
 * in because this module must not import registry.ts at runtime (cycle).
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
    ...(spec.createHookAdapter ? { createHookAdapter: spec.createHookAdapter } : {}),
  }
}
