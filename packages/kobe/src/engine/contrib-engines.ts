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
 * The screen manifests themselves live in `./contrib-screen-manifests.ts` —
 * they are observations of each CLI's own terminal UI and go stale for that
 * CLI's reasons, not for Rove's; this file is the registration table.
 */

import type { EngineIdentity } from "@/types/engine"
import {
  AMP,
  ANTIGRAVITY,
  CLINE,
  CURSOR,
  DEVIN,
  DROID,
  GEMINI,
  GROK,
  HERMES,
  KILO,
  KIRO,
  MAKI,
  MASTRACODE,
  OPENCODE,
  QODERCLI,
} from "./contrib-screen-manifests.ts"
import { CursorHookAdapter } from "./cursor-local/hook-adapter.ts"
import { DevinHookAdapter } from "./devin-local/hook-adapter.ts"
import { DroidHookAdapter } from "./droid-local/hook-adapter.ts"
import { GrokHookAdapter } from "./grok-local/hook-adapter.ts"
import { HermesHookAdapter } from "./hermes-local/hook-adapter.ts"
import type { EngineHookAdapter } from "./hook-adapter.ts"
import { MastracodeHookAdapter } from "./mastracode-local/hook-adapter.ts"
import { OpencodeFamilyHookAdapter } from "./opencode-local/hook-adapter.ts"
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
    createHookAdapter: () => new OpencodeFamilyHookAdapter("opencode"),
  },
  cursor: {
    displayName: "Cursor Agent",
    defaultCommand: ["cursor-agent"],
    screenManifest: CURSOR,
    createHookAdapter: () => new CursorHookAdapter(),
  },
  grok: {
    displayName: "Grok CLI",
    defaultCommand: ["grok"],
    screenManifest: GROK,
    createHookAdapter: () => new GrokHookAdapter(),
  },
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
  // The three below each declare a hook adapter, and none of their CLIs was on
  // the machine this was written on: the installed file shapes and payload
  // fields are what each CLI's own configuration documents, not a capture, and
  // the screen strings above come from the same reading.
  hermes: {
    displayName: "Hermes Agent",
    defaultCommand: ["hermes"],
    processNames: ["hermes-agent"],
    screenManifest: HERMES,
    createHookAdapter: () => new HermesHookAdapter(),
  },
  // `paste`, not the `argv` default: kilo is an OpenCode fork, and OpenCode's
  // positional is a project DIRECTORY, so an argv-delivered first message
  // becomes a path and the launch dies on it. Pasting is the safe direction
  // either way — it costs one keystroke round-trip and cannot mis-parse.
  kilo: {
    displayName: "Kilo",
    defaultCommand: ["kilo"],
    processNames: ["kilo-code"],
    screenManifest: KILO,
    firstMessageDelivery: "paste",
    createHookAdapter: () => new OpencodeFamilyHookAdapter("kilo"),
  },
  mastracode: {
    displayName: "MastraCode",
    defaultCommand: ["mastracode"],
    processNames: ["mastra-code"],
    screenManifest: MASTRACODE,
    createHookAdapter: () => new MastracodeHookAdapter(),
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
