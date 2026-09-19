/**
 * How each engine reports its state to Rove, read off this machine.
 *
 * Rove learns "what is this engine doing" through three independent layers,
 * and which of them an engine HAS is a fact about that engine, not a health
 * score. Top to bottom (`tui/workspace/turn-state-merge.ts` owns the
 * precedence, this module never restates it):
 *
 *   1. HOOKS — the engine reports events itself (`hook-adapter.ts`). The only
 *      layer that needs INSTALLING, so it is the only one with a disk state.
 *   2. COMPLETION MARKERS — the engine persists a turn-completion marker in
 *      its transcript that Rove can read back (`turn-detector.ts`).
 *   3. SCREEN — declarative rules over the pane capture (`screen-state.ts`),
 *      for engines whose own reporting cannot cover a state.
 *
 * An engine missing a layer is not a defect: claude's hooks report session,
 * turn start/complete/failed AND the permission prompt, so it needs no screen
 * rules — and could not use them anyway, because `mergeTurnStates` lets any
 * live hook claim win over the poll.
 *
 * Its own file rather than `cli/hook-cmd.ts` for the reason
 * `hook-config-check.ts` gives about `doctor`: a read-only status surface must
 * not take a runtime edge on a CLI verb's module, which lands as a bundle-only
 * TDZ crash in a neighbouring verb that neither tsc nor unit tests see.
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
 * `outdated` covers BOTH an entry stamped with an older {@link
 * ROVE_HOOK_VERSION} and one stamped with nothing at all — every install
 * written before the stamp existed. Reporting those as `installed` is what
 * this whole read exists to stop; reporting them as `not-installed` would be
 * a different lie, and would hide that the launch rewrite has something to
 * replace.
 */
export type HookInstallState = "installed" | "outdated" | "not-installed"

/** Every hook verb, as a regex alternation — an installed command names one. */
const VERB_ALTERNATION = ENGINE_ACTIVITY_KINDS.join("|")

/**
 * One persisted hook invocation plus its trailing flags. Deliberately a TEXT
 * scan rather than a per-format parse: the four adapters write the same argv
 * into three containers (Claude/Codex JSON, Kimi TOML, and — as a header
 * comment — the pi-family extension module), and a scan reads all three
 * without this module learning any of their shapes.
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
   * Why the hook merge into {@link hookFile} is being REFUSED, when it is.
   * Today the only symptom of a refused file is latency — every badge falls
   * back to the daemon's ~10s poll — and nothing says which file did it
   * unless someone thinks to run `rove doctor`.
   */
  readonly configIssue?: string
}

/**
 * Read one engine's integration row. Never throws: an unreadable or missing
 * config is `not-installed` (the first-launch case), which is what the
 * install action exists to fix.
 *
 * `adapter` comes from {@link activityHookAdapters}, which is the ONE answer
 * to "which engines get hooks" — the installer reads the same list. Asking
 * the registry here instead would be a second derivation, and the one that
 * goes stale: a hook adapter is no longer a built-in privilege (cursor is a
 * contrib entry that declares one), so the two lists have already diverged
 * once. `undefined` = this engine is not in that list.
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
 * Integration rows for the engines the caller lists — built-ins, the shipped
 * contrib catalog, plugin-registered and user-added ids alike. The vendor list
 * is a PARAMETER rather than something this module enumerates: the set of
 * engines Rove can launch is assembled from several sources that change at
 * runtime, and a second list here would be the one that silently goes stale
 * when an engine joins one of them.
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

/** Engines a single uninstall would actually change — anything with hooks on
 *  disk, current or stale. The mirror of {@link enginesNeedingHookInstall},
 *  so the two buttons never both read "nothing to do" while a file has
 *  Rove's entries in it. */
export function enginesWithHooksInstalled(rows: readonly EngineIntegration[]): readonly VendorId[] {
  return rows.filter((row) => row.hooksSupported && row.hookState !== "not-installed").map((row) => row.vendor)
}
