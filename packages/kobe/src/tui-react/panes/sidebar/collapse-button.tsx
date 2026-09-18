/** @jsxImportSource @opentui/react */
/**
 * The control that folds the task rail, in the rail's bottom-right corner.
 *
 * The corner is the placement (owner call 2026-09-18). The top-right corner is
 * where the update chip lands, so a control parked there competes with it
 * exactly when an update is pending; the bottom corner is empty at every moment
 * the rail has. Absolute, so it spends no line — the rail is the
 * tallest-pressure panel in the product and a whole line is real rent.
 *
 * Mouse only, deliberately. A chord that does the same job is a placement
 * decision the owner makes (docs/KEYBINDINGS.md), and shipping the button
 * first costs nothing that adding one later would have to undo.
 */

import { TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"

export interface CollapseButtonProps {
  readonly collapsed: boolean
  readonly onToggle: () => void
}

/**
 * Chevrons point the way the rail will move, so one control reads as both
 * verbs: `‹‹` folds it away, `››` brings it back. Doubled rather than single
 * because a lone chevron in a corner reads as a scroll hint.
 */
export function CollapseButton(props: CollapseButtonProps) {
  const { theme } = useTheme()
  return (
    <box
      position="absolute"
      bottom={0}
      right={1}
      flexShrink={0}
      onMouseUp={(evt: { stopPropagation(): void }) => {
        // Folding is not a request to move focus into the rail; without this
        // the pane shell's focus-grab fires on the same press and the sidebar
        // takes focus on its way out.
        evt.stopPropagation()
        props.onToggle()
      }}
    >
      <text fg={theme.textMuted} attributes={TextAttributes.BOLD} wrapMode="none">
        {props.collapsed ? "››" : "‹‹"}
      </text>
    </box>
  )
}
