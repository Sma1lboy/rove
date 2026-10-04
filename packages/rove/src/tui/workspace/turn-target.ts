/**
 * What a tab's turn detector tracks — one framework-free rule shared by
 * `turn-polls.ts` and `use-turn-polls.ts`. Every tab is a shell; the target is
 * its own kobe-launched engine or whatever its solo PTY is running (rationale
 * in `turn-polls.ts`'s header).
 */

import type { VendorId } from "@/types/vendor"
import { leaves } from "./split-core"
import { type TerminalTab, hasEngineLeaf, splitLeafPtyKey, tabPtyKey } from "./terminal-tabs-core"

/** The tab's single PTY key; null for a multi-leaf split, which has no single process. */
export function soloKey(taskId: string, tab: TerminalTab): string | null {
  const tabKey = tabPtyKey(taskId, tab.id)
  if (!tab.splitTree) return tabKey
  const ls = leaves(tab.splitTree.root)
  return ls.length === 1 ? splitLeafPtyKey(tabKey, ls[0].id) : null
}

/**
 * Whatever engine the live probe sees; the creation pin covers only the window
 * the probe can't answer (`vendorOf` → undefined, PTY not attached yet).
 * `vendorOf` is tri-state (`live-engine.ts`): vendor / null (no engine) /
 * undefined (couldn't look). The pin must not win unconditionally, or a
 * ctrl+C'd codex tab stays codex forever (wrong detector, identity, label); a
 * different engine typed into an engine tab is tracked instead.
 */
export function targetFor(
  taskId: string,
  tab: TerminalTab,
  taskVendor: VendorId,
  vendorOf: (key: string) => VendorId | null | undefined,
): { vendor: VendorId; key: string } | null {
  const key = soloKey(taskId, tab)
  const pinned = tab.kind === "engine" && hasEngineLeaf(tab.splitTree) ? (tab.vendor ?? taskVendor) : null
  if (!key) {
    // Multi-leaf split: the engine leaf's pin still runs the tab-key detector.
    return pinned ? { vendor: pinned, key: tabPtyKey(taskId, tab.id) } : null
  }
  const live = vendorOf(key)
  if (live) return { vendor: live, key }
  // undefined = spawn/attach window → trust the pin; null = confirmed bare
  // shell → no detector, even for an engine-born tab.
  if (live === undefined && pinned) return { vendor: pinned, key }
  return null
}
