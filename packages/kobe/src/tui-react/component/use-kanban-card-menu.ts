/**
 * The Kanban board's right-click menu: which card was clicked, the statuses it
 * can move to, and the highlight. What the menu offers lives here; what an
 * entry does is the page's mutation callback; `ContextMenu` only draws.
 * Menu-only verb, no chord, on purpose.
 */

import { ISSUE_STATUSES, type Issue, type IssueStatus } from "@sma1lboy/kobe-daemon/daemon/issues-store"
import { useCallback, useState } from "react"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { useGlobalMouseDown } from "../lib/use-global-mouse-down"
import type { ContextMenuEntry } from "../ui/context-menu"

/** Written out so the `Record` makes the compiler demand a key for a new status. */
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
  /** The page owns the mutation, its reload and its error toast. */
  readonly setStatus: (issue: Issue, status: IssueStatus) => void
  /** Moves the board cursor onto the menu's card so highlight and menu agree. */
  readonly onSelect: (issueId: number) => void
}): KanbanCardMenu {
  const t = useT()
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const [cursor, setCursor] = useState(0)

  const openForCard = useCallback(
    (issue: Issue, x: number, y: number): void => {
      // The current status is omitted: it would be a no-op write, and its
      // absence marks which one the card is on.
      const statuses = ISSUE_STATUSES.filter((status) => status !== issue.status)
      deps.onSelect(issue.id)
      setMenu({ issue, statuses, x, y })
      setCursor(0)
    },
    [deps.onSelect],
  )

  const close = useCallback((): void => setMenu(null), [])

  // A press elsewhere dismisses it; presses inside never reach the root
  // (`ContextMenu` stops the down phase), so picking still gets its mouse-up.
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
      // Close before dispatching: the mutation reloads the board underneath.
      const issue = menu.issue
      setMenu(null)
      deps.setStatus(issue, status)
    },
    [menu, deps.setStatus],
  )

  // Menu keys live with the menu state; the page's bindings just stand down
  // while it is open.
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
