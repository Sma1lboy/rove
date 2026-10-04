/** @jsxImportSource @opentui/react */
/**
 * The narrow layout's way back to the task list: the sidebar is off screen
 * there, so the content pane carries a clickable `‹ Tasks` row that names the
 * live `focus.sidebar` chord (rebound shows its cap, unbound drops).
 */

import { TextAttributes } from "@opentui/core"
import { formatChord } from "../../tui/lib/chord-glyphs"
import { legendCap } from "../../tui/lib/help-groups"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"

export function NarrowBackBar(props: { readonly onBack: () => void }) {
  const { theme } = useTheme()
  const t = useT()
  const cap = legendCap("focus.sidebar")
  return (
    <box
      flexDirection="row"
      flexShrink={0}
      gap={2}
      paddingLeft={1}
      // The content pane's own mouse-up focuses the workspace; it must not win.
      onMouseUp={(evt) => {
        evt.stopPropagation()
        props.onBack()
      }}
    >
      <text fg={theme.focusAccent} attributes={TextAttributes.BOLD} wrapMode="none">
        {`‹ ${t("workspace.narrowBack")}`}
      </text>
      {cap ? (
        <text fg={theme.textMuted} wrapMode="none">
          {formatChord(cap)}
        </text>
      ) : null}
    </box>
  )
}
