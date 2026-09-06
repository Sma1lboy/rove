/**
 * The Kanban board's right-click menu: which card was clicked, the statuses it
 * can move to, and the highlight.
 *
 * The board is otherwise read-only — the ONLY human route out of a column was
 * `enter` into the detail drawer, `tab` across its fields, a status change and
 * `esc` back out. The sidebar's task rows have offered a one-step "Set status"
 * from their own right-click menu since it shipped; this is that same gesture
 * on the surface where columns actually mean something.
 *
 * Same three-way seam as `use-tree-menu.ts`: what the menu OFFERS is here,
 * what an entry DOES is the page's mutation callback, and `ContextMenu` only
 * draws. No new chord — a menu-only verb, on purpose.
 */

import { ISSUE_STATUSES, type Issue, type IssueStatus } from "@sma1lboy/kobe-daemon/daemon/issues-store"
import { useCallback, useState } from "react"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { useGlobalMouseDown } from "../lib/use-global-mouse-down"
import type { ContextMenuEntry } from "../ui/context-menu"

/**
 * `IssueStatus` → its `kanban.detail.status.*` key. Written out rather than
 * built by string surgery for the reason `status-picker-dialog.tsx` gives:
 * the `Record` makes the compiler demand an entry the day a fifth status
 * lands, instead of rendering a raw wire value.
 */
const STATUS_LABEL_KEY: Record<IssueStatus, string> = {
  open: "kanban.detail.status.open",
  doing: "kanban.detail.status.doing",
  hold: "kanban.detail.status.hold",
  done: "kanban.detail.status.done",
}

export interface KanbanCardMenu {
  readonly open: boolean
  readonly issue: Issue | null
  readonly entries: readonly ContextMenuEntry[]
  readonly cursor: number
  readonly x: number
  readonly y: number
  readonly close: () => void
  readonly moveCursor: (delta: 1 | -1) => void
  /** Fire the highlighted entry (enter). */
  readonly pickCurrent: () => void
  /** Fire an entry by status id (a click on a menu row). */
  readonly pick: (id: string) => void
  /** Right-click landed on a card. */
  readonly openForCard: (issue: Issue, x: number, y: number) => void
}

interface OpenMenu {
  readonly issue: Issue
  readonly statuses: readonly IssueStatus[]
  readonly x: number
  readonly y: number
}

export function useKanbanCardMenu(deps: {
  /** Move the card. The page owns the mutation, its reload and its error
   *  toast — exactly as the drawer's own status change does. */
  readonly setStatus: (issue: Issue, status: IssueStatus) => void
  /** Move the board cursor onto the card the menu belongs to, so the
   *  highlight and the menu cannot disagree about which card acts next. */
  readonly onSelect: (issueId: number) => void
}): KanbanCardMenu {
  const t = useT()
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const [cursor, setCursor] = useState(0)

  const openForCard = useCallback(
    (issue: Issue, x: number, y: number): void => {
      // The card's CURRENT status is not offered: picking it would be a
      // write that moves nothing, and its absence is also what tells you
      // which one you are on without a marker column.
      const statuses = ISSUE_STATUSES.filter((status) => status !== issue.status)
      deps.onSelect(issue.id)
      setMenu({ issue, statuses, x, y })
      setCursor(0)
    },
    [deps.onSelect],
  )

  const close = useCallback((): void => setMenu(null), [])

  // A press anywhere else dismisses it. Presses INSIDE the menu never reach
  // the root (`ContextMenu` stops the down phase), so picking still gets its
  // mouse-up. Same rule as the sidebar's menu.
  useGlobalMouseDown(menu !== null, close)

  const moveCursor = useCallback(
    (delta: 1 | -1): void => {
      const count = menu?.statuses.length ?? 0
      if (count === 0) return
      setCursor((prev) => (prev + delta + count) % count)
    },
    [menu],
  )

  const fire = useCallback(
    (status: IssueStatus | undefined): void => {
      if (!menu || status === undefined) return
      // Close BEFORE dispatching: the mutation reloads the board underneath,
      // and a menu still painted over re-shuffled cards points at nothing.
      const issue = menu.issue
      setMenu(null)
      deps.setStatus(issue, status)
    },
    [menu, deps.setStatus],
  )

  // Menu-scope keys, owned HERE rather than by the page: the menu's state and
  // its keyboard are the same thing, and the page's own bindings only need to
  // know that they stand down while it is up. NO new chord — up/down/enter/
  // escape are what every open popup in the product already answers to.
  useBindings(() => ({
    enabled: menu !== null,
    bindings: [
      { key: "up", cmd: () => moveCursor(-1) },
      { key: "down", cmd: () => moveCursor(1) },
      { key: "return", cmd: () => fire(menu?.statuses[cursor]) },
      { key: "escape", cmd: close },
    ],
  }))

  return {
    open: menu !== null,
    issue: menu?.issue ?? null,
    entries: (menu?.statuses ?? []).map((status) => ({
      id: status,
      label: t("kanban.menu.setStatus", { status: t(STATUS_LABEL_KEY[status]) }),
    })),
    cursor,
    x: menu?.x ?? 0,
    y: menu?.y ?? 0,
    close,
    moveCursor,
    pickCurrent: () => fire(menu?.statuses[cursor]),
    pick: (id) => fire(menu?.statuses.find((status) => status === id)),
    openForCard,
  }
}
