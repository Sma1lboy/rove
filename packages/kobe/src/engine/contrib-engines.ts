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
  // Hook schemas and screen strings below are documentation-derived, not captured.
  hermes: {
    displayName: "Hermes Agent",
    defaultCommand: ["hermes"],
    processNames: ["hermes-agent"],
    screenManifest: HERMES,
    createHookAdapter: () => new HermesHookAdapter(),
  },
  // Like OpenCode, Kilo takes a project directory as its positional argument.
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
