/**
 * Vendor preference layers, as flat keys in the shared `state.json`:
 * `lastActiveVendor.<repo>` (per-project, written by Ctrl+Shift+T and
 * dialog picks) → `defaultVendor` (global, Settings-only) →
 * `lastSelectedVendor` (legacy pre-split key, read-only) → `claude`.
 * Per-TASK vendor lives on the task record, not here.
 */

import { DEFAULT_TASK_VENDOR } from "../types/task.ts"
import { BUILTIN_VENDORS, type VendorId, isBuiltinVendor } from "../types/vendor.ts"
import { getCustomEngineIds, getDisabledEngineIds, getPersistedString, setPersistedString } from "./repos.ts"

const REPO_KEY_PREFIX = "lastActiveVendor."

/**
 * Validate one persisted value; undefined lets the chain fall through.
 *
 * A DISABLED engine falls through too. Switching an engine off in Settings →
 * Engines is documented as "it stops being offered when you pick an engine
 * for a task", and the disabled set was read in exactly one place —
 * `availableEngineIds()`, which only feeds the TUI's picker. Every headless
 * path (`rove api add`, quick-fork, main-task) resolved its engine through
 * these preference layers instead and happily launched the engine the user
 * had turned off. The filter belongs on the layer both sides share.
 */
function validVendor(value: string | undefined, customIds: readonly string[]): VendorId | undefined {
  const v = value?.trim()
  if (!v) return undefined
  if (getDisabledEngineIds().includes(v)) return undefined
  if (isBuiltinVendor(v) || customIds.includes(v)) return v
  return undefined
}

/** First engine that is not switched off, for when every layer fell through.
 *  `DEFAULT_TASK_VENDOR` is the last resort even when it is itself disabled —
 *  a task needs SOME engine, and Settings refuses to disable the last one. */
function firstEnabledVendor(): VendorId {
  const disabled = new Set(getDisabledEngineIds())
  return [...BUILTIN_VENDORS, ...getCustomEngineIds()].find((id) => !disabled.has(id)) ?? DEFAULT_TASK_VENDOR
}

/** The project's last actively-used engine (undefined = never recorded). */
export function getRepoLastActiveVendor(repo: string): VendorId | undefined {
  return validVendor(getPersistedString(REPO_KEY_PREFIX + repo), getCustomEngineIds())
}

export function setRepoLastActiveVendor(repo: string, vendor: VendorId): void {
  setPersistedString(REPO_KEY_PREFIX + repo, vendor)
}

/** The Settings-owned global default (legacy key honored; undefined = unset). */
export function getGlobalDefaultVendor(): VendorId | undefined {
  const customIds = getCustomEngineIds()
  return (
    validVendor(getPersistedString("defaultVendor"), customIds) ??
    validVendor(getPersistedString("lastSelectedVendor"), customIds)
  )
}

export function setGlobalDefaultVendor(vendor: VendorId): void {
  setPersistedString("defaultVendor", vendor)
}

/**
 * The vendor a new task / relaunch should default to: the repo's last-active
 * engine, else the Settings global default, else the first engine that is
 * still switched on. Each level is validated independently, so a corrupt (or
 * disabled) repo entry falls through to the global default rather than
 * straight to the built-in fallback.
 */
export function resolvePreferredVendor(repo?: string): VendorId {
  const repoPick = repo ? getRepoLastActiveVendor(repo) : undefined
  return repoPick ?? getGlobalDefaultVendor() ?? firstEnabledVendor()
}
