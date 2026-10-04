/** @jsxImportSource @opentui/react */
/**
 * A right-click menu: a bordered, screen-clamped list anchored to the click.
 * Presentational only; the owner holds open/cursor state and key bindings.
 * Placement reuses the hover tooltip's clamp.
 */

import { TextAttributes } from "@opentui/core"
import { approxCellWidth } from "../../lib/display-width"
import { SIDEBAR_HOVER_TOOLTIP_Z_INDEX, resolveSidebarHoverTooltipLayout } from "../../tui/panes/sidebar/hover-layout"
import { truncateTitle } from "../../tui/panes/sidebar/labels"
import { useTheme } from "../context/theme"
import { FRAME } from "./frame"

/** Above the hover tooltip: the menu is what the user is interacting with. */
const CONTEXT_MENU_Z_INDEX = SIDEBAR_HOVER_TOOLTIP_Z_INDEX + 10

export interface ContextMenuEntry {
  readonly id: string
  readonly label: string
  readonly danger?: boolean
  /** Formatted live chord cap, right-aligned; absent when unbound. */
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
    // Measure label + cap together, or the border clips the cap.
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
      // `backgroundMenu`: its own lighter step separates the popup from the row it covers.
      backgroundColor={theme.backgroundMenu}
      paddingLeft={1}
      paddingRight={1}
      // Swallow the press so `useGlobalMouseDown` doesn't dismiss before the up fires the pick.
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
              // `background` is alpha-0 in transparent mode.
              fg={active ? theme.selectedListItemText : entry.danger ? theme.error : theme.text}
              attributes={active ? TextAttributes.BOLD : undefined}
              wrapMode="none"
              flexGrow={1}
            >
              {truncateTitle(entry.label, layout.innerWidth - capCells(entry))}
            </text>
            {entry.cap ? (
              <text
                fg={active ? theme.selectedListItemText : theme.textMuted}
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
