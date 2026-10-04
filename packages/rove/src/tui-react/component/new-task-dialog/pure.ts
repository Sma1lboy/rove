/** Framework-free new-task dialog helpers, testable without mounting
 *  (`test/tui-react/new-task-pure.test.ts`). No React, no fs. */

import { DEFAULT_TASK_VENDOR } from "@/types/task"
import { ALL_VENDORS, type VendorId } from "@/types/vendor"

/** Detected vendors, or the full list when none — the selector is never
 *  empty, so task creation is never blocked. */
export function resolveVendorSet(available: readonly VendorId[] | undefined): readonly VendorId[] {
  return available && available.length > 0 ? available : ALL_VENDORS
}

/**
 * Initial engine selection: the user's last-selected vendor, clamped to a
 * detected one (first detected wins when the preference isn't available).
 */
export function resolveInitialVendor(set: readonly VendorId[], preferred: VendorId | undefined): VendorId {
  const pref = preferred ?? DEFAULT_TASK_VENDOR
  return set.includes(pref) ? pref : (set[0] ?? DEFAULT_TASK_VENDOR)
}

/** Immutable toggle of one path in the adopt multi-select. */
export function toggleInSet(prev: ReadonlySet<string>, path: string): ReadonlySet<string> {
  const next = new Set(prev)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  return next
}

/**
 * Ctrl+A semantics on the Adopt tab: everything selected → clear;
 * otherwise select every visible path. Empty list returns `prev` unchanged.
 */
export function toggleSelectAll(prev: ReadonlySet<string>, paths: readonly string[]): ReadonlySet<string> {
  if (paths.length === 0) return prev
  const allSelected = paths.every((p) => prev.has(p))
  return allSelected ? new Set<string>() : new Set(paths)
}
