/** @jsxImportSource @opentui/react */
/**
 * A right-click menu, after the web's: a hairline-bordered, screen-clamped list anchored to the
 * click, its sections parted by a rule, the row under the cursor on a quiet fill. An entry's
 * choices open in a second list beside it, level with its row.
 * Presentational only; the owner holds open/cursor state and key bindings.
 * Placement reuses the hover tooltip's clamp.
 */

import { TextAttributes } from "@opentui/core"
import { approxCellWidth } from "@sma1lboy/rove-core/lib/display-width.ts"
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

/** A list one level down, open beside the entry at `anchor`. */
export interface ContextSubmenu {
  readonly anchor: number
  readonly entries: readonly ContextMenuEntry[]
  readonly cursor: number
  readonly onPick: (id: string) => void
  readonly onHover?: (index: number) => void
}

type Layout = ReturnType<typeof resolveSidebarHoverTooltipLayout>

/** A list's lines for the clamp: label and cap measured together, and a row for each rule. */
function menuLines(entries: readonly ContextMenuEntry[]): { text: string }[] {
  return [
    ...entries.map((entry) => ({ text: entry.label + " ".repeat(capCells(entry) + CAP_GAP) })),
    ...entries.flatMap((_, i) => (opensSection(entries, i) ? [{ text: "" }] : [])),
  ]
}

/** One bordered list at `layout`; `lit` keeps a second row lit (the entry whose choices are open). */
function MenuList(props: {
  readonly layout: Layout
  readonly entries: readonly ContextMenuEntry[]
  readonly cursor: number
  readonly lit?: number
  readonly onPick: (id: string) => void
  readonly onHover?: (index: number) => void
}) {
  const { theme } = useTheme()
  const { layout } = props
  // A step toward the ink from the menu's own surface, so the row under the cursor reads on it; a
  // palette theme has no inks to mix and keeps the element surface.
  const hoverFill =
    theme.text.intent === "rgb" && theme.backgroundMenu.intent === "rgb"
      ? mixInk(theme.text, theme.backgroundMenu, 0.14)
      : theme.backgroundElement
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
        const active = i === props.cursor || i === props.lit
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

export function ContextMenu(props: {
  readonly entries: readonly ContextMenuEntry[]
  /** The highlighted entry; -1 before the pointer or a key has picked one. */
  readonly cursor: number
  readonly x: number
  readonly y: number
  readonly dims: { width: number; height: number }
  readonly onPick: (id: string) => void
  /** The pointer came to rest on entry `index`: the owner moves its cursor there, as the web's menu does. */
  readonly onHover?: (index: number) => void
  readonly sub?: ContextSubmenu | null
}) {
  if (props.entries.length === 0) return null
  const screen = { screenWidth: props.dims.width, screenHeight: props.dims.height }
  // Never wider than the surface it is clamped to.
  const maxWidth = Math.min(SIDEBAR_HOVER_TOOLTIP_MAX_WIDTH, props.dims.width)
  const layout = resolveSidebarHoverTooltipLayout({
    hoverX: props.x,
    hoverY: props.y,
    ...screen,
    maxWidth,
    lines: menuLines(props.entries),
  })
  const sub = props.sub && props.sub.entries.length > 0 ? props.sub : null
  let subLayout: Layout | null = null
  if (sub) {
    // Beside the menu, its first row level with the entry that opened it; to the left when the right has no room.
    const rules = props.entries.slice(0, sub.anchor + 1).filter((_, i) => opensSection(props.entries, i)).length
    const anchorRow = layout.top + 1 + sub.anchor + rules
    const right = layout.left + layout.boxWidth
    // The clamp places a box two right and one below its point.
    const beside = resolveSidebarHoverTooltipLayout({
      hoverX: right - 2,
      hoverY: anchorRow - 2,
      ...screen,
      maxWidth,
      lines: menuLines(sub.entries),
    })
    subLayout = beside.left >= right ? beside : { ...beside, left: Math.max(0, layout.left - beside.boxWidth) }
  }
  return (
    <>
      <MenuList
        layout={layout}
        entries={props.entries}
        cursor={props.cursor}
        lit={sub?.anchor}
        onPick={props.onPick}
        onHover={props.onHover}
      />
      {sub && subLayout ? (
        <MenuList
          layout={subLayout}
          entries={sub.entries}
          cursor={sub.cursor}
          onPick={sub.onPick}
          onHover={sub.onHover}
        />
      ) : null}
    </>
  )
}
