/**
 * Framework-free file tree bindings: tab vocabulary plus the id → action map
 * the pane registers via `useBindings`. Single-sources the slot-multiplexed
 * dispatch that makes these chords rebindable.
 */

import { bindByIds } from "../../context/keybindings"
import type { Binding } from "../../lib/keymap-dispatch"

/** Here, not in the component, to avoid a view ↔ bindings-hook import cycle. */
export type FileTreeTab = "all" | "changes"

/** `[`/`]` cycle order; matches the visible chips. */
export const TAB_ORDER: readonly FileTreeTab[] = ["all", "changes"]

/** i18n key; resolved through a reactive `t` so language switches repaint. */
export function tabLabelKey(tab: FileTreeTab): string {
  switch (tab) {
    case "all":
      return "files.tabs.all"
    case "changes":
      return "files.tabs.changes"
  }
}

/** Plain thunks; React passes closures over the latest render. */
export type FileTreeController = {
  moveDown: () => void
  moveUp: () => void
  setTab: (tab: FileTreeTab) => void
  currentTab: () => FileTreeTab
  /** Calls `onOpenFile` upstream. */
  openCurrent: () => void
  /** `a` — `@<path>` mention into the engine composer (workspace host only). */
  mentionCurrent?: () => void
  /** Open in the OS default app (audio, video, PDF). */
  openExternal: () => void
  refresh: () => void
  /** `l` — expand current dir / descend into it / open file. */
  expandOrDescend: () => void
  /** `h` — collapse current dir or jump to parent. */
  collapseOrParent: () => void
  /** `b` — Changes tab: working-tree ↔ Branch (vs-base) scope. No-op on All. */
  toggleScope?: () => void
  /** `d` — read-only diff in a content tab (no focus steal); a dir row gets one combined diff. */
  openDiff?: () => void
  /** PROPOSED `D` — the same, for the whole worktree (pathspec `.`). */
  openDiffAll?: () => void
}

/**
 * Direction ids dispatch on the chord's SLOT (index in the id's keys), never
 * `evt.name`, so they stay rebindable. Layouts: SLOT_CONTRACTS
 * (lib/keymap-overrides.ts):
 *   files.nav        [down, up] pairs         (default j, k, down, up)
 *   files.hierarchy  [collapse, expand] pairs (default h, l, left, right)
 *   files.tab        [previous, next] pairs   (default [, ])
 */
export function fileTreeBindings(opts: FileTreeController): Binding[] {
  return bindByIds({
    "files.nav": (_evt, slot) => {
      if ((slot ?? 0) % 2 === 0) opts.moveDown()
      else opts.moveUp()
    },
    "files.hierarchy": (_evt, slot) => {
      if ((slot ?? 0) % 2 === 0) opts.collapseOrParent()
      else opts.expandOrDescend()
    },
    "files.tab": (_evt, slot) => {
      const cur = opts.currentTab()
      const idx = TAB_ORDER.indexOf(cur)
      if (idx < 0) return
      const delta = (slot ?? 0) % 2 === 0 ? -1 : 1
      const next = TAB_ORDER[(idx + delta + TAB_ORDER.length) % TAB_ORDER.length]
      if (next) opts.setTab(next)
    },
    "files.open": () => opts.openCurrent(),
    "files.mention": () => opts.mentionCurrent?.(),
    "files.openExternal": () => opts.openExternal(),
    "files.refresh": () => opts.refresh(),
    "files.scope": () => opts.toggleScope?.(),
    "files.diff": () => opts.openDiff?.(),
    "files.diffAll": () => opts.openDiffAll?.(),
  })
}
