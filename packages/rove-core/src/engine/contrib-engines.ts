/**
 * Shipped contrib engines as DATA: id, display name, launch command and a
 * screen-state manifest (`./screen-state.ts`), plus whichever optional
 * capabilities of the base contract the CLI was checked to support (model
 * flag, list verb, hook adapter…). Plugins register the same shape.
 *
 * A contrib engine appears in the new-task selector only when
 * `defaultCommand[0]` is on PATH (`account-detect.ts`), so the catalog costs
 * users without these CLIs nothing. Blocked rules go before working rules.
 */

import { homedir } from "node:os"
import { join } from "node:path"
import { bypassFlag } from "@sma1lboy/rove-core/lib/argv.ts"
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
import { MastracodeHookAdapter } from "./mastracode-local/hook-adapter.ts"
import { listModelLines } from "./model-lists.ts"
import { OpencodeFamilyHookAdapter } from "./opencode-local/hook-adapter.ts"
import { QodercliHookAdapter } from "./qodercli-local/hook-adapter.ts"
import type { EngineRegistryEntry } from "./registry.ts"
import type { EngineScreenManifest } from "./screen-state.ts"
import { skillsDirUnder, xdgConfigHome } from "./vendor-home.ts"

/**
 * A contrib engine is an {@link EngineRegistryEntry} minus the registry's own
 * keys: name, command and screen manifest are required, every capability the
 * base contract has is available and optional. Derived, not listed, so a new
 * base capability needs no edit here.
 */
export type ContribEngineSpec = Pick<EngineRegistryEntry, "displayName" | "defaultCommand"> & {
  readonly screenManifest: EngineScreenManifest
} & Partial<Omit<EngineRegistryEntry, "vendor" | "builtin" | "displayName" | "defaultCommand" | "screenManifest">>

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
    permissionBypass: bypassFlag("--force", "-f", "--yolo"),
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
    permissionBypass: bypassFlag("--dangerously-skip-permissions"),
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
  // An explicit `undefined` must not erase the base's default (e.g. `history`).
  const declared = Object.fromEntries(Object.entries(spec).filter(([, v]) => v !== undefined))
  return { ...base, ...declared }
}
