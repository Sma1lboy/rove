/**
 * Shipped contrib engines — the long tail, as DATA.
 *
 * A contrib engine is everything kobe needs to launch a coding CLI and
 * badge its activity, without a dedicated adapter: an id, a display name,
 * a launch command, and a screen-state manifest (`./screen-state.ts`).
 * No account detector and no history reader — those are what make an engine a
 * BUILT-IN, and each one is real per-vendor work. A hook adapter is the one
 * piece a contrib entry MAY declare (`createHookAdapter`, cursor being the
 * worked example), because installing a hook needs nothing from the rest of
 * the built-in surface. A contrib entry is ~10 lines; a future plugin
 * registers exactly this shape.
 *
 * Selection gating: a contrib engine appears in the new-task selector only
 * when its binary is on PATH (`account-detect.ts` probes `defaultCommand[0]`
 * with the same generic `which` the custom-engine launch would hit anyway),
 * so shipping the catalog costs users without these CLIs nothing.
 *
 * Screen manifests are reduced to the classifier's vocabulary. Blocked rules
 * go before working rules.
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
   * How this CLI accepts a session's FIRST message — same field the built-in
   * table declares (see `registry.ts`). Contrib entries otherwise inherit the
   * `"argv"` default, which appends the prompt as a positional; declare
   * `"paste"` when the positional slot means something else, or the launch
   * dies on the prompt text.
   */
  readonly firstMessageDelivery?: "argv" | "paste"
  /**
   * This engine's activity-hook installer — the A layer, OPTIONAL because most
   * of the long tail has no hook mechanism Rove has wired. Declaring one costs
   * the rest of the catalog nothing: an entry without it keeps the base's
   * `NoopHookAdapter` and stays screen-only, with no install, no warning and no
   * new file on anyone's disk.
   *
   * Declaring one does NOT replace {@link screenManifest} — they are different
   * rungs of the same ladder (`registry.ts`'s `screenManifest` doc). Cursor is
   * the worked example: its hook reports session identity, its manifest keeps
   * reporting state.
   */
  readonly createHookAdapter?: () => EngineHookAdapter
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

// ── Screen-only engines (no hook, no history) ──────────────────────────────
// The four below have no hook integration at all, so reading the pane is the
// ONLY way Rove learns their state.
//
// The classifier's rule model is deliberately small, and two shapes these
// screens want have no equivalent here:
//   - OR-of-ANDs (`any = [{ contains = [a, b] }, …]`). A rule here takes at
//     most one `any`, so each conjunctive disjunct becomes its own rule with
//     the same state — first match wins, so N same-state rules ARE an OR.
//   - `not` gates. No negation at all; a rule that needs one is dropped, and
//     said so below.
// A whole-screen region collapses to the classifier's default bottom
// region (12 non-empty lines), the same reduction the six entries above made:
// a dialog taller than that is missed. Missing is the safe direction — a
// false `blocked` lights the attention inbox and keeps it lit.
// `\p{Alphabetic}` becomes `[A-Za-z]` wherever it appears: the classifier
// compiles patterns without the `u` flag, so a non-Latin word after a spinner
// glyph no longer matches.

// Only the permission rule survives. A catch-all "any non-empty cline screen
// is working" rule was considered and dropped: classifyScreen's answer IS the
// badge, so it would pin cline to running for the tab's whole life with
// nothing able to bring it down.
// `null` (keep the previous reading) is the honest answer for a cline screen
// with no dialog on it, so cline ships blocked-only until someone with the
// CLI installed captures its real working/resting footer.
const CLINE: EngineScreenManifest = {
  rules: [
    { state: "blocked", any: ["let cline use this tool"] },
    // The remaining four disjuncts are the [act mode]/[plan mode] ×
    // execute-a-command/use-a-tool cross product; two rules cover it exactly.
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
    // The screen carries one of "tool approval"/"tool approvals"; the
    // singular is a prefix of the plural, so one substring covers both and
    // the rule's single `any` slot stays free for the action list.
    {
      state: "blocked",
      all: ["pending from subagents", "tool approval"],
      any: ["approve all pending", "configure individually", "exit (cancel subagents)"],
    },
    { state: "working", any: ["kiro is working"] },
    { state: "working", all: ["esc to cancel"], lineRegex: ["^\\s*[◔◑◕●]\\s+[A-Za-z]"] },
  ],
}

// Maki keeps a
// one-line status bar on the bottom row — `[BUILD]`/`[PLAN]`/`[BASH]` at rest,
// with a leading braille cell while it streams — hence the `bottomLines: 1`.
// DROPPED: a `prompt_box_idle` fallback (a bare `❯ ` on a pane narrow
// enough that the status bar's right half has overwritten the mode label). It
// is only correct behind two `not` gates; ungated it reads a streaming maki as
// idle, so on a narrow pane maki reports `null` instead of `idle`.
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

// Antigravity's manifest id is "agy", not its command name. OSC-title and
// OSC-progress regions have no counterpart in the classifier, but this
// manifest declares none.
const ANTIGRAVITY: EngineScreenManifest = {
  rules: [
    { state: "blocked", all: ["requesting permission for:", "do you want to proceed?"] },
    { state: "blocked", all: ["requesting permission for:", "tab amend", "edit command"] },
    { state: "working", lineRegex: ["^\\s*[\\u2800-\\u28FF]+\\s+[A-Za-z]+\\w*ing\\b"] },
    { state: "working", bottomLines: 5, lineRegex: ["·\\s*[1-9][0-9]*\\s+task"] },
  ],
}

// Rove's rule vocabulary has no `not` gate; the negations the working and
// idle rules would need only exclude the blocked/working conditions that
// already sit ABOVE them here, and first match wins, so the ordering does
// that job.
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

// Qodercli's blocked screen has eight alternatives, two of them conjunctions
// — one rule each here, since a Rove rule's `any` slot is already spoken for
// by the conjunction's second half. Its whole-screen region is this
// classifier's default window.
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
  // devin and qodercli, like droid and cursor, are catalog entries that ALSO
  // declare a hook adapter: their `SessionStart` reports which session is live
  // and the manifest above keeps owning working/blocked/idle. Command names
  // and `processNames` are each CLI's own executable plus its known
  // aliases; neither CLI was on the machine this
  // was written on, so both keep the "argv" first-message default (positional
  // semantics UNVERIFIED) and every screen string comes from the manifest
  // rather than a fresh capture.
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
  // Command names are each CLI's own executable, NOT the manifest ids:
  // antigravity's manifest is "agy" and kiro's binary is `kiro-cli`.
  // `processNames` carries the other spellings a running process may wear, so
  // it still maps back to the engine (`foreground.ts`). None of these four CLIs was on the
  // machine this was written on, so every screen string below comes from the
  // manifest rather than a fresh capture; each keeps the "argv" first-message
  // default because their positional semantics are likewise UNVERIFIED.
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
    ...(spec.createHookAdapter ? { createHookAdapter: spec.createHookAdapter } : {}),
  }
}
