/**
 * Tree sidebar keybindings — one registration instead of the six that grew
 * here as modes were added.
 *
 * The previous SidebarTree.tsx registered a separate `useBindings` entry for
 * main navigation, move-mode escape, search mode, menu navigation, menu
 * escape, and the global jump chord. The stack order and the overlapping
 * `enabled` flags made the real priority (menu > search > move > main) hard to
 * see, and adding a new mode meant adding yet another hook call. This hook
 * declares the same chords once and routes each press through an explicit
 * mode-guard, so the dispatch table is the only place that knows about modes.
 *
 * `tasks.jump` stays outside this hook: it is intentionally always enabled
 * (it switches tasks from inside the engine pane), while every other sidebar
 * chord is gated on the sidebar having focus.
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
  readonly onArchiveRequest?: (id: string) => void
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
    onArchiveRequest,
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

  useBindings(() => ({
    enabled: focused,
    bindings: [
      ...bindByIds({
        // j/k/down/up are multiplexed across every mode that needs them. The
        // keymap dispatcher matches the first binding for a key inside a single
        // config, so this handler must route all cases instead of registering
        // separate per-mode rows.
        "sidebar.nav": (_evt, slot) => {
          const down = (slot ?? 0) % 2 === 0
          if (menu.open) {
            menu.moveCursor(down ? 1 : -1)
            return
          }
          if (search.active) {
            // Search uses down/up to walk matches; j/k are text in the query.
            if (down) controller.moveDown()
            else controller.moveUp()
            return
          }
          markKeysUsed()
          if (moveMode) {
            moveCursorRow(down ? 1 : -1)
            return
          }
          if (down) controller.moveDown()
          else controller.moveUp()
        },
        // Return/enter is likewise multiplexed: menu pick, search submit,
        // move-mode exit, or plain row activation.
        "sidebar.select": () => {
          if (menu.open) {
            menu.pickCurrent()
            return
          }
          if (search.active) {
            controller.selectCurrent()
            search.exit()
            return
          }
          markKeysUsed()
          if (moveMode) {
            onMoveModeExit?.()
            return
          }
          controller.selectCurrent()
        },
        "sidebar.goto": (_evt, slot) => {
          if (menu.open || search.active || moveMode) return
          if ((slot ?? 0) % 2 === 1) controller.pressShiftG()
          else controller.pressG()
        },
        "sidebar.tree.open": () => {
          if (menu.open || search.active || moveMode) return
          controller.selectCurrent()
        },
        "sidebar.search.enter": () => {
          if (menu.open || search.active || moveMode) return
          search.enter()
        },
        "sidebar.delete": () => {
          if (menu.open || search.active || moveMode) return
          markKeysUsed()
          withCursorTask(onDeleteRequest)
        },
        "sidebar.archive": () => {
          if (menu.open || search.active || moveMode) return
          markKeysUsed()
          withCursorTask(onArchiveRequest)
        },
        "sidebar.rename": () => {
          if (menu.open || search.active || moveMode) return
          markKeysUsed()
          withCursorTask(onRenameRequest)
        },
        "sidebar.localMerge": () => {
          if (menu.open || search.active || moveMode) return
          withCursorTask(onLocalMergeRequest)
        },
        "sidebar.pin": () => {
          if (menu.open || search.active || moveMode) return
          markKeysUsed()
          withCursorTask(onPinRequest)
        },
      }),
      {
        key: "escape",
        cmd: () => {
          if (menu.open) menu.close()
          else if (search.active) search.exit()
          else if (moveMode) onMoveModeExit?.()
        },
      },
    ],
  }))
}
