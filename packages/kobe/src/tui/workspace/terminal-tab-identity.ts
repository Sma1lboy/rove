/**
 * The one transition that turns an engine tab back into a shell tab when its
 * engine exits. Every tab IS a shell (`shellSpawn` types the CLI into it), so
 * `kind` means what runs NOW, not what the tab was born as. Resetting it once
 * at exit keeps the state dot, optimistic activity marks and `tabTitleStable`
 * in agreement without per-consumer guards.
 *
 * Deliberately not the inverse: a shell the user types `claude` into is an
 * agent for glyph/detector purposes (the live probe and `targetFor` handle
 * that), but it has no kobe-pinned session, so promoting `kind` would claim a
 * resume story that doesn't exist.
 */

import type { VendorId } from "../../types/vendor"
import type { TerminalTab } from "./terminal-tabs-core"

export function createTabIdentityObserver() {
  const observed = new Map<string, VendorId>()
  return (tab: TerminalTab, live: VendorId | null | undefined, shell: readonly string[]): TerminalTab => {
    const previous = observed.get(tab.id)
    if (live) observed.set(tab.id, live)
    else observed.delete(tab.id)
    return demoteExitedEngine(tab, previous, live, shell)
  }
}

/**
 * Reset an exited engine tab to a shell; returns the same tab when nothing
 * changes, so callers can assign unconditionally.
 *
 * Fires only on a real vendor → confirmed-null EDGE across one probe
 * (`live-engine.ts` tri-state): `live === null` alone would demote during the
 * spawn window, before the engine appears in the process tree.
 *
 * Drops only engine state: the session pin (a re-acquire spawns a plain
 * shell, as `rehydrateTabs` does) and `lastTitle` (a status-owning engine's
 * spinner phrase). Manual `title`, ordinal, split layout and `autoTitle`
 * survive, so the label is byte-identical to what `tabTitleStable` computed.
 */
export function demoteExitedEngine(
  tab: TerminalTab,
  prev: VendorId | null | undefined,
  live: VendorId | null | undefined,
  shell: readonly string[],
): TerminalTab {
  if (tab.kind !== "engine" || live !== null || !prev) return tab
  // A viewport tab (`ptyTask`) only views another task's session; this
  // workspace doesn't own its lifecycle.
  if (tab.ptyTask) return tab
  return {
    kind: "command",
    command: shell,
    id: tab.id,
    title: tab.title,
    ordinal: tab.ordinal,
    ...(tab.autoTitle !== undefined ? { autoTitle: tab.autoTitle } : {}),
    ...(tab.splitTree !== undefined ? { splitTree: tab.splitTree } : {}),
    lastTitle: null,
    liveVendor: null,
  }
}
