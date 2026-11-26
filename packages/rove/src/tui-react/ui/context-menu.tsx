/** @jsxImportSource @opentui/react */
/**
 * A right-click menu, after the web's: a hairline-bordered, screen-clamped list anchored to the
 * click, its sections parted by a rule, the row under the cursor on a quiet fill.
 * Presentational only; the owner holds open/cursor state and key bindings.
 * Placement reuses the hover tooltip's clamp.
 */

import { TextAttributes } from "@opentui/core"
import { approxCellWidth } from "../../lib/display-width"
import { mixInk } from "../../tui/lib/breathe"
import {
  SIDEBAR_HOVER_TOOLTIP_MAX_WIDTH,
  SIDEBAR_HOVER_TOOLTIP_Z_INDEX,
  resolveSidebarHoverTooltipLayout,
} from "../../tui/panes/sidebar/hover-layout"
import { truncateTitle } from "../../tui/panes/sidebar/labels"
import { useTheme } from "../context/theme"
import { FRAME } from "./frame"

/** Above the hover tooltip: the menu is what the user is interacting with. */
const CONTEXT_MENU_Z_INDEX = SIDEBAR_HOVER_TOOLTIP_Z_INDEX + 10

export interface ContextMenuEntry {
  readonly id: string
  readonly label: string
  readonly danger?: boolean
  /** Entries sharing a section sit together; a rule falls where it changes. */
  readonly section?: string
  /** Formatted live chord cap, right-aligned; absent when unbound. */
  readonly cap?: string
}

/** Cells the cap column steals from a row's label (cap + one space gutter). */
function capCells(entry: ContextMenuEntry): number {
  return entry.cap ? approxCellWidth(entry.cap) + 1 : 0
}

/** Extra cells between the longest label and its cap, the web's column gap. */
const CAP_GAP = 2

/** Whether entry `i` starts a section after another one. */
function opensSection(entries: readonly ContextMenuEntry[], i: number): boolean {
  const entry = entries[i]
  return i > 0 && entry?.section !== undefined && entries[i - 1]?.section !== entry.section
}

export function ContextMenu(props: {
  readonly entries: readonly ContextMenuEntry[]
  readonly cursor: number
  readonly x: number
  readonly y: number
  readonly dims: { width: number; height: number }
  readonly onPick: (id: string) => void
  /** The pointer came to rest on entry `index`: the owner moves its cursor there, as the web's menu does. */
  readonly onHover?: (index: number) => void
}) {
  const { theme } = useTheme()
  // A step toward the ink from the menu's own surface, so the row under the cursor reads on it; a
  // palette theme has no inks to mix and keeps the element surface.
  const hoverFill =
    theme.text.intent === "rgb" && theme.backgroundMenu.intent === "rgb"
      ? mixInk(theme.text, theme.backgroundMenu, 0.14)
      : theme.backgroundElement
  if (props.entries.length === 0) return null
  const layout = resolveSidebarHoverTooltipLayout({
    hoverX: props.x,
    hoverY: props.y,
    screenWidth: props.dims.width,
    screenHeight: props.dims.height,
    // Never wider than the surface it is clamped to: past the rail's edge it would sit under the workspace.
    maxWidth: Math.min(SIDEBAR_HOVER_TOOLTIP_MAX_WIDTH, props.dims.width),
    // Measure label + cap together, or the border clips the cap.
    lines: [
      ...props.entries.map((entry) => ({ text: entry.label + " ".repeat(capCells(entry) + CAP_GAP) })),
      // A rule is a row too: the clamp must count it or a tall menu runs off the screen.
      ...props.entries.flatMap((entry, i) => (opensSection(props.entries, i) ? [{ text: "" }] : [])),
    ],
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
      borderColor={theme.border}
      // `backgroundMenu`: its own lighter step separates the popup from the row it covers.
      backgroundColor={theme.backgroundMenu}
      paddingLeft={1}
      paddingRight={1}
      // Swallow the press so `useGlobalMouseDown` doesn't dismiss before the up fires the pick.
      onMouseDown={(e: { stopPropagation(): void }) => e.stopPropagation()}
    >
      {props.entries.map((entry, i) => {
        const active = i === props.cursor
        // The web's row: a quiet fill under the cursor, the error fill on a destructive entry.
        const fill = active ? (entry.danger ? theme.error : hoverFill) : undefined
        const ink = active && entry.danger ? theme.selectedListItemText : entry.danger ? theme.error : theme.text
        return [
          opensSection(props.entries, i) ? (
            <text key={`rule-${entry.id}`} fg={theme.border} wrapMode="none" flexShrink={0}>
              {"─".repeat(layout.innerWidth)}
            </text>
          ) : null,
          // biome-ignore lint/a11y/useKeyWithMouseEvents: a terminal box takes no focus; j/k move the same cursor
          <box
            key={entry.id}
            flexShrink={0}
            flexDirection="row"
            backgroundColor={fill}
            onMouseUp={() => props.onPick(entry.id)}
            onMouseOver={() => props.onHover?.(i)}
          >
            <text fg={ink} wrapMode="none" flexGrow={1}>
              {truncateTitle(entry.label, layout.innerWidth - capCells(entry))}
            </text>
            {entry.cap ? (
              <text
                // The web's meta column: subtle at rest, a step stronger on the row under the cursor.
                fg={active && entry.danger ? theme.selectedListItemText : theme.textMuted}
                attributes={active ? undefined : TextAttributes.DIM}
                wrapMode="none"
                flexShrink={0}
              >
                {entry.cap}
              </text>
            ) : null}
          </box>,
        ]
      })}
    </box>
  )
}
