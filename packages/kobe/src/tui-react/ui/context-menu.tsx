/** @jsxImportSource @opentui/react */
/**
 * A right-click menu: a bordered, screen-clamped list of labels anchored to
 * the click.
 *
 * Presentational only — the owner holds the open/cursor state and does the
 * key binding, the same split the sidebar already uses (`panel.tsx` renders,
 * `Sidebar.tsx` decides). That keeps this component reusable by any pane that
 * wants a menu without inheriting the sidebar's state machine.
 *
 * Placement reuses the hover tooltip's clamp: "a box of text lines pinned near
 * a point, kept on screen" is the same geometry problem, and one implementation
 * means one set of off-by-one bugs.
 */

import { TextAttributes } from "@opentui/core"
import { approxCellWidth } from "../../lib/display-width"
import { SIDEBAR_HOVER_TOOLTIP_Z_INDEX, resolveSidebarHoverTooltipLayout } from "../../tui/panes/sidebar/hover-layout"
import { truncateTitle } from "../../tui/panes/sidebar/labels"
import { useTheme } from "../context/theme"
import { FRAME } from "./frame"

/** Above the hover tooltip: if both are somehow up, the menu is the one the
 *  user is interacting with. */
const CONTEXT_MENU_Z_INDEX = SIDEBAR_HOVER_TOOLTIP_Z_INDEX + 10

export interface ContextMenuEntry {
  readonly id: string
  readonly label: string
  readonly danger?: boolean
  /** Live chord cap for the entry, already formatted; absent when the verb
   *  has no binding. Right-aligned so the labels stay a readable column. */
  readonly cap?: string
}

/** Cells the cap column steals from a row's label (cap + one space gutter). */
function capCells(entry: ContextMenuEntry): number {
  return entry.cap ? approxCellWidth(entry.cap) + 1 : 0
}

export function ContextMenu(props: {
  readonly entries: readonly ContextMenuEntry[]
  readonly cursor: number
  readonly x: number
  readonly y: number
  readonly dims: { width: number; height: number }
  readonly onPick: (id: string) => void
}) {
  const { theme } = useTheme()
  if (props.entries.length === 0) return null
  const layout = resolveSidebarHoverTooltipLayout({
    hoverX: props.x,
    hoverY: props.y,
    screenWidth: props.dims.width,
    screenHeight: props.dims.height,
    // Measure label + cap together: a cap sized out of the box would be
    // clipped by the border it is supposed to sit inside.
    lines: props.entries.map((entry) => ({ text: entry.label + " ".repeat(capCells(entry)) })),
  })
  return (
    <box
      position="absolute"
      zIndex={CONTEXT_MENU_Z_INDEX}
      left={layout.left}
      top={layout.top}
      width={layout.boxWidth}
      flexDirection="column"
      {...FRAME}
      borderColor={theme.focusAccent}
      backgroundColor={theme.backgroundElement}
      paddingLeft={1}
      paddingRight={1}
      // The menu swallows its own press so the owner's "a click landed
      // elsewhere → dismiss" listener (`useGlobalMouseDown`) never sees it —
      // otherwise the down phase of picking an entry would close the menu
      // before the up phase could fire it.
      onMouseDown={(e: { stopPropagation(): void }) => e.stopPropagation()}
    >
      {props.entries.map((entry, i) => {
        const active = i === props.cursor
        return (
          <box
            key={entry.id}
            flexShrink={0}
            flexDirection="row"
            backgroundColor={active ? theme.focusAccent : undefined}
            onMouseUp={() => props.onPick(entry.id)}
          >
            <text
              // Contrast fg on the accent fill: `background` is alpha-0 in
              // transparent mode, so a filled row must not use it.
              fg={active ? theme.backgroundElement : entry.danger ? theme.error : theme.text}
              attributes={active ? TextAttributes.BOLD : undefined}
              wrapMode="none"
              flexGrow={1}
            >
              {truncateTitle(entry.label, layout.innerWidth - capCells(entry))}
            </text>
            {entry.cap ? (
              <text
                fg={active ? theme.backgroundElement : theme.textMuted}
                attributes={active ? undefined : TextAttributes.DIM}
                wrapMode="none"
                flexShrink={0}
              >
                {entry.cap}
              </text>
            ) : null}
          </box>
        )
      })}
    </box>
  )
}
