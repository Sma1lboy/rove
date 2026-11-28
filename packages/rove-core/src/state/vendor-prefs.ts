/**
 * Vendor preference layers, as flat keys in the shared `state.json`:
 * `lastActiveVendor` (the last engine picked anywhere, written by every
 * pick and by Settings' default) → `defaultVendor` (Settings) →
 * `lastSelectedVendor` (legacy key, read-only) → first enabled engine.
 * Per-TASK vendor lives on the task record, not here.
 */

import { DEFAULT_TASK_VENDOR } from "../types/task.ts"
import { BUILTIN_VENDORS, type VendorId, isBuiltinVendor } from "../types/vendor.ts"
import { getCustomEngineIds, getDisabledEngineIds, getPersistedString, setPersistedString } from "./repos.ts"

const LAST_ACTIVE_KEY = "lastActiveVendor"

/**
 * Validate one persisted value; undefined lets the chain fall through.
 * A DISABLED engine falls through too: headless paths (`rove api add`,
 * quick-fork, project checkout) resolve through these layers, not the TUI picker.
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

/** The last engine picked, in any project (undefined = never recorded). */
export function getLastActiveVendor(): VendorId | undefined {
  return validVendor(getPersistedString(LAST_ACTIVE_KEY), getCustomEngineIds())
}

export function setLastActiveVendor(vendor: VendorId): void {
  setPersistedString(LAST_ACTIVE_KEY, vendor)
}

/** The Settings-owned global default (legacy key honored; undefined = unset). */
export function getGlobalDefaultVendor(): VendorId | undefined {
  const customIds = getCustomEngineIds()
  return (
    validVendor(getPersistedString("defaultVendor"), customIds) ??
    validVendor(getPersistedString("lastSelectedVendor"), customIds)
  )
}

/** Also the newest pick: a default that the last pick outranked would change nothing. */
export function setGlobalDefaultVendor(vendor: VendorId): void {
  setPersistedString("defaultVendor", vendor)
  setLastActiveVendor(vendor)
}

/**
 * Default vendor for a new task / relaunch. Each layer is validated
 * independently, so a corrupt or disabled last pick falls through to the
 * global default, not straight to the fallback.
 */
export function resolvePreferredVendor(): VendorId {
  return getLastActiveVendor() ?? getGlobalDefaultVendor() ?? firstEnabledVendor()
}
