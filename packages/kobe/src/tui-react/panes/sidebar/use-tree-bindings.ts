/**
 * Tree sidebar keybindings — collapsed from six `useBindings` calls in
 * `SidebarTree.tsx` down to four, while preserving the original dispatch
 * priority and every user-rebindable registry id.
 *
 * Why not literally one registration:
 *   - `escape` must NOT be registered when no mode is active, or the sidebar
 *     silently consumes an otherwise harmless key (regression).
 *   - `sidebar.search.cancel`, `sidebar.search.nav`, and
 *     `sidebar.search.submit` are registry ids the user may rebind; they must
 *     stay routed through `bindByIds`.
 *
 * So the split follows the real modes:
 *   1. Main navigation & action chords (no mode active).
 *   2. Move-mode escape (raw key — there is no registry id for this).
 *   3. Search-mode chords (registry ids).
 *   4. Menu-mode chords + menu escape.
 *
 * Registration order mirrors the old code (main → move → search → menu), so
 * the LIFO stack priority stays identical: menu > search > move > main.
 */

import type { createSidebarController } from "../../../tui/panes/sidebar/controller"
import { RECENT_ROW_ID, parseRowId } from "../../../tui/panes/sidebar/tree-core"
import { bindByIds } from "../../context/keybindings"
import { useBindings } from "../../lib/keymap"
import type { TreeMenu } from "./use-tree-menu"
import type { TreeSearch } from "./use-tree-search"

export interface TreeBindingsOpts {
  readonly focused: boolean
  readonly search: TreeSearch
  readonly menu: Pick<TreeMenu, "open" | "moveCursor" | "pickCurrent" | "close">
  readonly moveMode: boolean
  readonly onMoveModeExit?: () => void
  readonly controller: ReturnType<typeof createSidebarController>
  readonly flatIdsRef: React.MutableRefObject<readonly string[]>
  readonly cursorRef: React.MutableRefObject<number>
  readonly moveCursorRow: (delta: -1 | 1) => void
  readonly onDeleteRequest?: (id: string) => void
  readonly onRenameRequest?: (id: string) => void
  readonly onPinRequest?: (id: string) => void
  readonly onLocalMergeRequest?: (id: string) => void
  readonly markKeysUsed: () => void
}

export function useTreeBindings(opts: TreeBindingsOpts): void {
  const {
    focused,
    search,
    menu,
    moveMode,
    onMoveModeExit,
    controller,
    flatIdsRef,
    cursorRef,
    moveCursorRow,
    onDeleteRequest,
    onRenameRequest,
    onPinRequest,
    onLocalMergeRequest,
    markKeysUsed,
  } = opts

  function withCursorTask(fn?: (taskId: string) => void): void {
    const rowId = flatIdsRef.current[cursorRef.current]
    if (rowId === undefined || !fn) return
    if (rowId === RECENT_ROW_ID) return
    fn(parseRowId(rowId).taskId)
  }

  // 1. Main navigation & per-row verbs — only when no transient mode has the
  //    keyboard.
  useBindings(() => ({
    enabled: focused && !search.active && !menu.open,
    bindings: bindByIds({
      "sidebar.nav": (_evt, slot) => {
        markKeysUsed()
        const down = (slot ?? 0) % 2 === 0
        if (moveMode) {
          moveCursorRow(down ? 1 : -1)
          return
        }
        if (down) controller.moveDown()
        else controller.moveUp()
      },
      "sidebar.select": () => {
        markKeysUsed()
        if (moveMode) {
          onMoveModeExit?.()
          return
        }
        controller.selectCurrent()
      },
      "sidebar.goto": (_evt, slot) => {
        if (moveMode) return
        if ((slot ?? 0) % 2 === 1) controller.pressShiftG()
        else controller.pressG()
      },
      "sidebar.tree.open": () => {
        if (moveMode) return
        controller.selectCurrent()
      },
      "sidebar.search.enter": () => {
        if (moveMode) return
        search.enter()
      },
      "sidebar.delete": () => {
        if (moveMode) return
        markKeysUsed()
        withCursorTask(onDeleteRequest)
      },
      "sidebar.rename": () => {
        if (moveMode) return
        markKeysUsed()
        withCursorTask(onRenameRequest)
      },
      "sidebar.localMerge": () => withCursorTask(onLocalMergeRequest),
      "sidebar.pin": () => {
        if (moveMode) return
        markKeysUsed()
        withCursorTask(onPinRequest)
      },
    }),
  }))

  // 2. Move-mode escape — no registry id covers this, so it is a raw key.
  useBindings(() => ({
    enabled: focused && moveMode,
    bindings: [{ key: "escape", cmd: () => onMoveModeExit?.() }],
  }))

  // 3. Search-mode chords — registry ids so user rebinding keeps working.
  useBindings(() => ({
    enabled: focused && search.active,
    bindings: bindByIds({
      "sidebar.search.nav": (_evt, slot) => {
        const down = (slot ?? 0) % 2 === 0
        if (down) controller.moveDown()
        else controller.moveUp()
      },
      "sidebar.search.submit": () => {
        controller.selectCurrent()
        search.exit()
      },
      "sidebar.search.cancel": () => search.exit(),
    }),
  }))

  // 4. Menu-mode chords — retarget j/k/enter at the menu, and close it on
  //    escape. Kept separate from main so the same `sidebar.nav`/`sidebar.select`
  //    ids can be reused without within-config key collisions.
  useBindings(() => ({
    enabled: focused && menu.open,
    bindings: [
      ...bindByIds({
        "sidebar.nav": (_evt, slot) => menu.moveCursor((slot ?? 0) % 2 === 0 ? 1 : -1),
        "sidebar.select": () => menu.pickCurrent(),
      }),
      { key: "escape", cmd: () => menu.close() },
    ],
  }))
}
