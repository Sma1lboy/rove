/** @jsxImportSource @opentui/react */
/**
 * Folds the task rail. Bottom-right corner (owner call): the top-right is
 * where the update chip lands. Absolute, so it spends no line of the rail.
 * Mouse only: a chord is the owner's placement call (docs/KEYBINDINGS.md).
 */

import { useTheme } from "../../context/theme"
import { useHoverFill } from "../../ui/use-hover-fill"

export interface CollapseButtonProps {
  readonly collapsed: boolean
  readonly onToggle: () => void
  /** Sit in the flow instead of pinning to the rail's bottom-right corner.
   *  The expanded rail has a foot row for it; the collapsed rail has
   *  no such row and keeps the corner. */
  readonly inline?: boolean
}

/** A chevron pointing the way the rail will move: the fold chevron of the project headers, turned. */
export function CollapseButton(props: CollapseButtonProps) {
  const { theme } = useTheme()
  const hover = useHoverFill()
  // Stop the pane shell's focus-grab: folding must not focus the sidebar.
  const onMouseUp = (evt: { stopPropagation(): void }) => {
    evt.stopPropagation()
    props.onToggle()
  }
  const glyph = (
    <text fg={hover.hovered ? theme.text : theme.textMuted} wrapMode="none">
      {props.collapsed ? "›" : "‹"}
    </text>
  )
  if (props.inline) {
    return (
      <box flexShrink={0} backgroundColor={hover.fill} {...hover.handlers} onMouseUp={onMouseUp}>
        {glyph}
      </box>
    )
  }
  return (
    <box
      position="absolute"
      bottom={0}
      right={1}
      flexShrink={0}
      backgroundColor={hover.fill}
      {...hover.handlers}
      onMouseUp={onMouseUp}
    >
      {glyph}
    </box>
  )
}
