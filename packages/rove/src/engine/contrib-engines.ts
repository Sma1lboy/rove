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

import { homedir } from "node:os"
import { join } from "node:path"
import type { EngineIdentity } from "@/types/engine"
import { trustAntigravityWorktree } from "./antigravity-local/trust.ts"
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
import { ANTIGRAVITY_ICON } from "./engine-icons.ts"
import { GrokHookAdapter, grokConfigDir } from "./grok-local/hook-adapter.ts"
import { HermesHookAdapter, hermesConfigDir } from "./hermes-local/hook-adapter.ts"
import type { EngineHookAdapter } from "./hook-adapter.ts"
import { MastracodeHookAdapter } from "./mastracode-local/hook-adapter.ts"
import { listModelLines } from "./model-lists.ts"
import { OpencodeFamilyHookAdapter } from "./opencode-local/hook-adapter.ts"
import { QodercliHookAdapter } from "./qodercli-local/hook-adapter.ts"
import type { EngineIcon, EngineRegistryEntry } from "./registry.ts"
import type { EngineScreenManifest } from "./screen-state.ts"
import { skillsDirUnder, xdgConfigHome } from "./vendor-home.ts"

export interface ContribEngineSpec {
  readonly displayName: string
  /** See `EngineRegistryEntry.icon`. */
  readonly icon?: EngineIcon
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
  /** See `EngineRegistryEntry.firstMessageArgv`. */
  readonly firstMessageArgv?: EngineRegistryEntry["firstMessageArgv"]
  /** See `EngineRegistryEntry.trustWorktree`. */
  readonly trustWorktree?: EngineRegistryEntry["trustWorktree"]
  /**
   * Optional activity-hook installer. Without it the entry keeps the base's
   * `NoopHookAdapter`: screen-only, no install, no warning, no file written.
   * It does NOT replace {@link screenManifest}: the hook reports session
   * identity, the manifest keeps reporting state.
   */
  readonly createHookAdapter?: () => EngineHookAdapter
  /** See `EngineRegistryEntry.skillsDir`. */
  readonly skillsDir?: () => string | null
  /** See `EngineRegistryEntry.listModels`. */
  readonly listModels?: EngineRegistryEntry["listModels"]
  /** See `EngineRegistryEntry.modelArgv`. */
  readonly modelArgv?: EngineRegistryEntry["modelArgv"]
  /** See `EngineRegistryEntry.effortLevels`; pair with {@link effortArgv}. */
  readonly effortLevels?: EngineRegistryEntry["effortLevels"]
  /** See `EngineRegistryEntry.effortArgv`. */
  readonly effortArgv?: EngineRegistryEntry["effortArgv"]
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
  gemini: {
    displayName: "Gemini CLI",
    defaultCommand: ["gemini"],
    screenManifest: GEMINI,
    // `-m/--model` is documentation-derived, unverified (CLI not installed here).
    modelArgv: (base, model) => [...base, "--model", model],
    skillsDir: () => skillsDirUnder(join(homedir(), ".gemini")),
  },
  // opencode's positional is a project DIRECTORY: an argv first message exits
  // `Failed to change directory to <cwd>/<prompt>` (opencode 0.6.3). Other
  // entries keep "argv" with positional semantics UNVERIFIED.
  opencode: {
    displayName: "OpenCode",
    defaultCommand: ["opencode"],
    screenManifest: OPENCODE,
    firstMessageDelivery: "paste",
    listModels: listModelLines("opencode", ["models"]),
    modelArgv: (base, model) => [...base, "--model", model],
    createHookAdapter: () => new OpencodeFamilyHookAdapter("opencode"),
    skillsDir: () => skillsDirUnder(join(xdgConfigHome(), "opencode")),
  },
  cursor: {
    displayName: "Cursor Agent",
    defaultCommand: ["cursor-agent"],
    screenManifest: CURSOR,
    // `--model` per cursor-agent 2026.09.15 `--help`; its list verb needs a login, so no list.
    modelArgv: (base, model) => [...base, "--model", model],
    createHookAdapter: () => new CursorHookAdapter(),
    skillsDir: () => skillsDirUnder(join(homedir(), ".cursor")),
  },
  grok: {
    displayName: "Grok CLI",
    defaultCommand: ["grok"],
    screenManifest: GROK,
    createHookAdapter: () => new GrokHookAdapter(),
    skillsDir: () => skillsDirUnder(grokConfigDir()),
  },
  droid: {
    displayName: "Droid",
    defaultCommand: ["droid"],
    screenManifest: DROID,
    createHookAdapter: () => new DroidHookAdapter(),
    skillsDir: () => skillsDirUnder(join(homedir(), ".factory")),
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
    skillsDir: () => skillsDirUnder(join(xdgConfigHome(), "devin")),
  },
  qodercli: {
    displayName: "Qoder CLI",
    defaultCommand: ["qodercli"],
    processNames: ["qoder", "qoderclicn", "qodercn"],
    screenManifest: QODERCLI,
    createHookAdapter: () => new QodercliHookAdapter(),
    skillsDir: () => skillsDirUnder(join(homedir(), ".qoder")),
  },
  // Commands are each CLI's executable, not the manifest id (kiro → `kiro-cli`).
  // `processNames` maps other process spellings back (`foreground.ts`). Screen
  // strings are uncaptured and "argv" delivery is UNVERIFIED for these four.
  cline: { displayName: "Cline", defaultCommand: ["cline"], screenManifest: CLINE },
  kiro: {
    displayName: "Kiro CLI",
    defaultCommand: ["kiro-cli"],
    processNames: ["kiro"],
    screenManifest: KIRO,
    skillsDir: () => skillsDirUnder(join(homedir(), ".kiro")),
  },
  maki: { displayName: "Maki", defaultCommand: ["maki"], screenManifest: MAKI },
  // A positional exits `unexpected argument` (agy 1.5.17); `-i` runs the prompt and stays interactive.
  antigravity: {
    displayName: "Antigravity",
    icon: ANTIGRAVITY_ICON,
    defaultCommand: ["agy"],
    processNames: ["antigravity", "antigravity-cli"],
    screenManifest: ANTIGRAVITY,
    firstMessageArgv: (argv, text) => [...argv, "-i", text],
    trustWorktree: trustAntigravityWorktree,
    listModels: listModelLines("agy", ["models"]),
    modelArgv: (base, model) => [...base, "--model", model],
    effortLevels: ["low", "medium", "high", "xhigh", "max"],
    effortArgv: (base, level) => [...base, "--effort", level],
    skillsDir: () => skillsDirUnder(join(homedir(), ".gemini", "antigravity")),
  },
  // Hook schemas and screen strings below are documentation-derived, not captured.
  hermes: {
    displayName: "Hermes Agent",
    defaultCommand: ["hermes"],
    processNames: ["hermes-agent"],
    screenManifest: HERMES,
    createHookAdapter: () => new HermesHookAdapter(),
    skillsDir: () => skillsDirUnder(hermesConfigDir()),
  },
  // Like OpenCode, Kilo takes a project directory as its positional argument.
  kilo: {
    displayName: "Kilo",
    defaultCommand: ["kilo"],
    processNames: ["kilo-code"],
    screenManifest: KILO,
    firstMessageDelivery: "paste",
    createHookAdapter: () => new OpencodeFamilyHookAdapter("kilo"),
    skillsDir: () => skillsDirUnder(join(homedir(), ".kilo")),
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
    ...(spec.icon ? { icon: spec.icon } : {}),
    defaultCommand: spec.defaultCommand,
    ...(spec.processNames ? { processNames: spec.processNames } : {}),
    screenManifest: spec.screenManifest,
    ...(spec.identity ? { identity: spec.identity } : {}),
    ...(spec.firstMessageDelivery ? { firstMessageDelivery: spec.firstMessageDelivery } : {}),
    ...(spec.firstMessageArgv ? { firstMessageArgv: spec.firstMessageArgv } : {}),
    ...(spec.trustWorktree ? { trustWorktree: spec.trustWorktree } : {}),
    ...(spec.createHookAdapter ? { createHookAdapter: spec.createHookAdapter } : {}),
    ...(spec.skillsDir ? { skillsDir: spec.skillsDir } : {}),
    ...(spec.listModels ? { listModels: spec.listModels } : {}),
    ...(spec.modelArgv ? { modelArgv: spec.modelArgv } : {}),
    ...(spec.effortLevels && spec.effortArgv ? { effortLevels: spec.effortLevels, effortArgv: spec.effortArgv } : {}),
  }
}
