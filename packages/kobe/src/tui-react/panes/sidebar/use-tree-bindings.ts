/**
 * Tree sidebar keybindings, one registration per mode. Not one registration:
 * `escape` must NOT be bound when no mode is active, or the sidebar silently
 * eats it; and the search chords are user-rebindable registry ids.
 *
 * Registration order main → move → search → menu gives the LIFO stack the
 * priority menu > search > move > main.
 */

import type { createSidebarController } from "../../../tui/panes/sidebar/controller"
import { RECENT_ROW_ID, parseRowId } from "../../../tui/panes/sidebar/tree-core"
import { bindByIds } from "../../context/keybindings"
import { useBindings } from "../../lib/keymap"
import type { SidebarTaskCallbacks } from "./types"
import type { TreeMenu } from "./use-tree-menu"
import type { TreeSearch } from "./use-tree-search"

export interface TreeBindingsOpts
  extends Readonly<
    Pick<SidebarTaskCallbacks, "onDeleteRequest" | "onRenameRequest" | "onPinRequest" | "onLocalMergeRequest">
  > {
  readonly focused: boolean
  readonly search: TreeSearch
  readonly menu: Pick<TreeMenu, "open" | "moveCursor" | "pickCurrent" | "close">
  readonly moveMode: boolean
  readonly onMoveModeExit?: () => void
  readonly controller: ReturnType<typeof createSidebarController>
  readonly flatIdsRef: React.MutableRefObject<readonly string[]>
  readonly cursorRef: React.MutableRefObject<number>
  readonly moveCursorRow: (delta: -1 | 1) => void
  readonly markKeysUsed: () => void
}

/** The task a cursor row names, or null ("↩ recent", empty tree). Shared with
 *  the host's `b`/`v`/`o` chords so both resolve the same target. */
export function cursorTaskIdOf(rowId: string | undefined): string | null {
  if (rowId === undefined || rowId === RECENT_ROW_ID) return null
  return parseRowId(rowId).taskId
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
    const taskId = cursorTaskIdOf(flatIdsRef.current[cursorRef.current])
    if (taskId !== null && fn) fn(taskId)
  }

  // 1. Main navigation & per-row verbs.
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

  // 2. Move-mode escape: no registry id, so a raw key.
  useBindings(() => ({
    enabled: focused && moveMode,
    bindings: [{ key: "escape", cmd: () => onMoveModeExit?.() }],
  }))

  // 3. Search mode.
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

  // 4. Menu mode: separate so `sidebar.nav`/`sidebar.select` reuse doesn't collide.
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
