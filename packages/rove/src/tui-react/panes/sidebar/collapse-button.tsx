/** @jsxImportSource @opentui/react */
/**
 * Folds the task rail. Bottom-right corner (owner call): the top-right is
 * where the update chip lands. Absolute, so it spends no line of the rail.
 * Mouse only: a chord is the owner's placement call (docs/KEYBINDINGS.md).
 */

import { TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"

export interface CollapseButtonProps {
  readonly collapsed: boolean
  readonly onToggle: () => void
  /** Sit in the flow instead of pinning to the rail's bottom-right corner.
   *  The expanded rail shares a row with the zen chip; the collapsed rail has
   *  no such row and keeps the corner. */
  readonly inline?: boolean
}

/** Chevrons point the way the rail will move; doubled because a lone chevron reads as a scroll hint. */
export function CollapseButton(props: CollapseButtonProps) {
  const { theme } = useTheme()
  // Stop the pane shell's focus-grab: folding must not focus the sidebar.
  const onMouseUp = (evt: { stopPropagation(): void }) => {
    evt.stopPropagation()
    props.onToggle()
  }
  const glyph = (
    <text fg={theme.textMuted} attributes={TextAttributes.BOLD} wrapMode="none">
      {props.collapsed ? "››" : "‹‹"}
    </text>
  )
  if (props.inline) {
    return (
      <box flexShrink={0} onMouseUp={onMouseUp}>
        {glyph}
      </box>
    )
  }
  return (
    <box position="absolute" bottom={0} right={1} flexShrink={0} onMouseUp={onMouseUp}>
      {glyph}
    </box>
  )
}
