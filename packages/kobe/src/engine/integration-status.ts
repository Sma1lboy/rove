/**
 * How each engine reports its state to Rove, read off this machine.
 *
 * Three independent reporting layers; which ones an engine HAS is a fact, not
 * a health score. Precedence is owned by `tui/workspace/turn-state-merge.ts`.
 *
 *   1. HOOKS (`hook-adapter.ts`): the only layer that needs INSTALLING, so
 *      the only one with a disk state.
 *   2. COMPLETION MARKERS in the transcript (`turn-detector.ts`).
 *   3. SCREEN rules over the pane capture (`screen-state.ts`).
 *
 * A missing layer is not a defect: claude's hooks cover every state, and any
 * live hook claim beats the poll in `mergeTurnStates` anyway.
 *
 * Not in `cli/hook-cmd.ts`: a runtime edge from a status surface onto a CLI
 * verb's module lands as a bundle-only TDZ crash neither tsc nor unit tests
 * see (see `hook-config-check.ts`).
 */

import { readFileSync } from "node:fs"
import type { VendorId } from "../types/vendor.ts"
import { type EngineHookAdapter, activityHookAdapters } from "./hook-adapter.ts"
import { hookConfigIssues } from "./hook-config-check.ts"
import { ENGINE_ACTIVITY_KINDS } from "./hook-events.ts"
import { ROVE_HOOK_VERSION } from "./json-hooks.ts"
import { engineEntry } from "./registry.ts"

/**
 * What is on disk for an engine's activity hooks.
 *
 * `outdated` covers BOTH an older {@link ROVE_HOOK_VERSION} stamp and no stamp
 * at all. Not `not-installed`: that would hide that the launch rewrite has
 * something to replace.
 */
export type HookInstallState = "installed" | "outdated" | "not-installed"

/** Every hook verb, as a regex alternation — an installed command names one. */
const VERB_ALTERNATION = ENGINE_ACTIVITY_KINDS.join("|")

/**
 * One persisted hook invocation plus its trailing flags. A TEXT scan, not a
 * per-format parse, so it reads JSON (Claude/Codex), TOML (Kimi) and the
 * pi-family extension's header comment without learning their shapes.
 */
const HOOK_CALL = new RegExp(String.raw`\bhook\s+(?:${VERB_ALTERNATION})\b([^"'\n]*)`, "g")
const VERSION_FLAG = /--hook-version[ =]+(\d+)/
/** The pi-family extension's own stamp (it builds its argv at runtime). */
const EXTENSION_VERSION = /ROVE_HOOK_VERSION=(\d+)/
/** A pi-family extension written before the stamp existed. */
const EXTENSION_BANNER = /Rove activity hook/

/**
 * Classify the BYTES of an engine's hook config. Pure, so the three-way
 * verdict is unit-testable without touching a real engine's home.
 */
export function readHookInstallState(text: string, current: number = ROVE_HOOK_VERSION): HookInstallState {
  const stamped = EXTENSION_VERSION.exec(text)
  if (stamped) return Number(stamped[1]) === current ? "installed" : "outdated"
  if (EXTENSION_BANNER.test(text)) return "outdated"
  let found = false
  for (const match of text.matchAll(HOOK_CALL)) {
    found = true
    const version = VERSION_FLAG.exec(match[1] ?? "")
    // One stale entry makes the whole file stale: the installer rewrites its
    // own group wholesale, so a mixed file is mid-upgrade, not half-fine.
    if (!version || Number(version[1]) !== current) return "outdated"
  }
  return found ? "installed" : "not-installed"
}

/** Which layers an engine reports through, and what the top one looks like on disk. */
export interface EngineIntegration {
  readonly vendor: VendorId
  /** False when this engine has no hook adapter at all (contrib, custom). */
  readonly hooksSupported: boolean
  /** `not-installed` both for "never written" and for an unsupported engine. */
  readonly hookState: HookInstallState
  /** The engine config the hooks live in; `""` when the engine has none. */
  readonly hookFile: string
  /** The engine persists a turn-completion marker Rove can read back. */
  readonly markers: boolean
  /** The engine declares screen-classification rules. */
  readonly screen: boolean
  /**
   * Why the hook merge into {@link hookFile} is REFUSED, when it is. Otherwise
   * the only symptom is latency (badges fall back to the daemon's ~10s poll).
   */
  readonly configIssue?: string
}

/**
 * Read one engine's integration row. Never throws: a missing or unreadable
 * config is `not-installed`.
 *
 * `adapter` comes from {@link activityHookAdapters}, the ONE list the
 * installer also reads; deriving it from the registry would drift (contrib
 * entries like cursor declare adapters too). `undefined` = not in that list.
 */
function integrationFor(
  vendor: VendorId,
  adapter: EngineHookAdapter | undefined,
  issues: ReadonlyMap<string, string>,
): EngineIntegration {
  const entry = engineEntry(vendor)
  const hooksSupported = adapter !== undefined
  const hookFile = adapter?.globalSettingsPath() ?? ""
  let hookState: HookInstallState = "not-installed"
  if (hookFile) {
    try {
      hookState = readHookInstallState(readFileSync(hookFile, "utf8"))
    } catch {
      /* missing / unreadable → the engine has never been hooked here */
    }
  }
  const configIssue = hookFile ? issues.get(hookFile) : undefined
  return {
    vendor,
    hooksSupported,
    hookState,
    hookFile,
    markers: entry.createTurnDetector().supportsCompletionMarkers(),
    screen: entry.screenManifest !== undefined,
    ...(configIssue ? { configIssue } : {}),
  }
}

/**
 * Integration rows for the engines the caller lists. A PARAMETER because the
 * launchable set is assembled at runtime from several sources; a second list
 * here would silently go stale.
 */
export function engineIntegrations(vendors: readonly VendorId[]): EngineIntegration[] {
  const issues = new Map(hookConfigIssues().map((issue) => [issue.file, issue.reason]))
  const adapters = new Map(activityHookAdapters().map((adapter) => [adapter.vendor, adapter]))
  return vendors.map((vendor) => integrationFor(vendor, adapters.get(vendor), issues))
}

/** Engines whose hooks a single install action would actually change. */
export function enginesNeedingHookInstall(rows: readonly EngineIntegration[]): readonly VendorId[] {
  return rows.filter((row) => row.hooksSupported && row.hookState !== "installed").map((row) => row.vendor)
}

/** Engines a single uninstall would change: any hooks on disk, current or
 *  stale, so install and uninstall never both read "nothing to do". */
export function enginesWithHooksInstalled(rows: readonly EngineIntegration[]): readonly VendorId[] {
  return rows.filter((row) => row.hooksSupported && row.hookState !== "not-installed").map((row) => row.vendor)
}
