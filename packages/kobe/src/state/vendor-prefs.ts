/**
 * Vendor preference layers, as flat keys in the shared `state.json`:
 * `lastActiveVendor.<repo>` (per-project, written by Ctrl+Shift+T and
 * dialog picks) → `defaultVendor` (global, Settings-only) →
 * `lastSelectedVendor` (legacy key, read-only) → first enabled engine.
 * Per-TASK vendor lives on the task record, not here.
 */

import { DEFAULT_TASK_VENDOR } from "../types/task.ts"
import { BUILTIN_VENDORS, type VendorId, isBuiltinVendor } from "../types/vendor.ts"
import { getCustomEngineIds, getDisabledEngineIds, getPersistedString, setPersistedString } from "./repos.ts"

const REPO_KEY_PREFIX = "lastActiveVendor."

/**
 * Validate one persisted value; undefined lets the chain fall through.
 * A DISABLED engine falls through too: headless paths (`rove api add`,
 * quick-fork, main-task) resolve through these layers, not the TUI picker.
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
 * Default vendor for a new task / relaunch. Each layer is validated
 * independently, so a corrupt or disabled repo entry falls through to the
 * global default, not straight to the fallback.
 */
export function resolvePreferredVendor(repo?: string): VendorId {
  const repoPick = repo ? getRepoLastActiveVendor(repo) : undefined
  return repoPick ?? getGlobalDefaultVendor() ?? firstEnabledVendor()
}
